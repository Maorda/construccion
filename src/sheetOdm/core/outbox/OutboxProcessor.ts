import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getRepositoryToken } from '@sheetOdm/utils/helper.js';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service.js';
import { OutboxStatus } from '@sheetOdm/core/outbox/OutboxEntry.js';
import { PrismaService } from '@sheetOdm/services/prisma.service.js';
import type { DatabaseModuleOptions } from '@sheetOdm/interfaces/database.options.interface.js';

@Injectable()
export class OutboxProcessor implements OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy {
    private readonly logger = new Logger(OutboxProcessor.name);
    private isRunning = false;
    private isShuttingDown = false;
    private timeoutId?: NodeJS.Timeout;

    constructor(
        private readonly moduleRef: ModuleRef,
        private readonly db: PrismaService, // Motor Prisma
        @Inject('DATABASE_OPTIONS') private readonly options: DatabaseModuleOptions,
        private readonly metadataRegistry: MetadataRegistry,
    ) { }

    onApplicationBootstrap() {
        this.logger.log('🚀 Outbox Processor inicializado.');
        this.scheduleNextTick();
    }

    onApplicationShutdown() {
        this.logger.log('🛑 Apagando Outbox Processor de forma segura...');
        this.isShuttingDown = true;
        if (this.timeoutId) clearTimeout(this.timeoutId);
    }

    private scheduleNextTick() {
        if (this.isShuttingDown) return;
        const interval = this.options.outboxPollingInterval || 10000;
        this.timeoutId = setTimeout(() => this.processPendingOperations(), interval);
    }

    private async processPendingOperations() {
        if (this.isRunning || this.isShuttingDown) return;
        this.isRunning = true;

        try {
            // 1. Obtener tareas usando el nombre correcto de tu modelo Prisma (outboxEntry)
            const pendingTasks = await this.db.outboxEntry.findMany({
                where: { status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] } },
                orderBy: { createdAt: 'asc' },
                take: 50, // Lote generoso para agrupar
            });

            if (pendingTasks.length === 0) return;

            // Transición a PROCESSING
            const taskIds = pendingTasks.map(t => t.id);
            await this.db.outboxEntry.updateMany({
                where: { id: { in: taskIds } },
                data: { status: OutboxStatus.PROCESSING, startedAt: new Date() }
            });

            // 2. Agrupar tareas por Entidad (El paso clave para evitar colapsar la API)
            const groupedTasks: Record<string, typeof pendingTasks> = {};
            for (const task of pendingTasks) {
                if (!groupedTasks[task.entityName]) groupedTasks[task.entityName] = [];
                groupedTasks[task.entityName].push(task);
            }

            // 3. Procesar cada grupo con su repositorio dinámico
            for (const [entityName, tasks] of Object.entries(groupedTasks)) {
                if (this.isShuttingDown) break;
                await this.processGroup(entityName, tasks);
            }

        } catch (error) {
            this.logger.error('❌ Error crítico en el ciclo del procesador', error);
        } finally {
            this.isRunning = false;
            this.scheduleNextTick(); // Reloj seguro
        }
    }

    private async processGroup(entityName: string, tasks: any[]) {
        let repo: any;
        try {
            // Resolución dinámica de tu ODM
            const entityClass = this.metadataRegistry.getEntityByName(entityName);
            const repoToken = getRepositoryToken(entityClass);
            repo = this.moduleRef.get(repoToken, { strict: false });
        } catch (err) {
            this.logger.error(`❌ Fallo de inyección para la entidad: ${entityName}`);
            await this.markAs(tasks, OutboxStatus.FAILED, err.message);
            return;
        }

        try {
            // 🔥 VERDADERA INSERCIÓN MASIVA: Pasamos todo el arreglo junto
            const documents = tasks.map(t => t.payload || t.doc);
            await repo.commitBulk(documents);

            await this.markAs(tasks, OutboxStatus.COMPLETED);
            this.logger.log(`✅ ${tasks.length} registros de [${entityName}] guardados en Sheets.`);
        } catch (error: any) {
            this.logger.error(`⚠️ Falló lote de ${entityName}. Degragando a reintento individual...`);
            for (const task of tasks) {
                await this.handleIndividualFailure(task, error.message);
            }
        }
    }

    // --- Utilidades de actualización en BD local ---
    private async markAs(tasks: any[], status: OutboxStatus, errorMsg?: string) {
        await this.db.outboxEntry.updateMany({
            where: { id: { in: tasks.map(t => t.id) } },
            data: { status, finishedAt: status === OutboxStatus.COMPLETED ? new Date() : undefined, error: errorMsg }
        });
    }

    private async handleIndividualFailure(task: any, errorMessage: string) {
        const attempts = task.attempts + 1;
        await this.db.outboxEntry.update({
            where: { id: task.id },
            data: {
                status: attempts >= 5 ? OutboxStatus.FAILED : OutboxStatus.PENDING,
                attempts,
                error: errorMessage,
                updatedAt: new Date()
            }
        });
    }
    onModuleDestroy() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            console.log('--- ✅ OutboxProcessor detenido ---');
        }
    }
}