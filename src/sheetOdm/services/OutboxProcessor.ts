import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ModuleRef } from '@nestjs/core';
import { getRepositoryToken } from '@sheetOdm/utils/helper';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service'; // Asegúrate de tener acceso a esto

@Injectable()
export class OutboxProcessor {
    private readonly logger = new Logger(OutboxProcessor.name);
    private isRunning = false; // Flag para evitar concurrencia

    constructor(
        private readonly moduleRef: ModuleRef,
        private readonly db: MyDatabaseService, // Tu servicio de acceso a BD (Prisma, TypeORM, etc.)
    ) { }

    // Cron se ejecuta cada 10 segundos
    @Cron(CronExpression.EVERY_10_SECONDS)
    async processPendingOperations() {
        if (this.isRunning) {
            this.logger.debug('⌛ El worker está ocupado, omitiendo ciclo.');
            return;
        }

        this.isRunning = true;
        this.logger.log('🚀 Iniciando procesamiento de la Outbox...');

        try {
            // 1. Obtener lotes pendientes (Prioridad FIFO)
            const pendingTasks = await this.db.outbox.findMany({
                where: { status: 'PENDING' },
                orderBy: { timestamp: 'asc' },
                take: 10, // Procesamos de 10 en 10 para no saturar Google API
            });

            for (const task of pendingTasks) {
                await this.processTask(task);
            }
        } catch (error) {
            this.logger.error('❌ Error crítico en el ciclo del worker', error);
        } finally {
            this.isRunning = false;
        }
    }

    private async processTask(task: any) {
        try {
            // 2. Marcar como 'PROCESSING' para evitar que otro worker tome esta tarea
            await this.db.outbox.update({
                where: { id: task.id },
                data: { status: 'PROCESSING', startedAt: new Date() }
            });

            // 3. Recuperar el Repositorio dinámicamente
            // Usamos el nombre de la entidad guardado en la Outbox
            const entityClass = MetadataRegistry.getClassByName(task.entityName);
            const repoToken = getRepositoryToken(entityClass);
            const repo = this.moduleRef.get(repoToken, { strict: false });

            // 4. Ejecutar la operación (Esperamos que commitBulk reciba un array)
            await repo.commitBulk([task.doc]);

            // 5. Marcar como completado
            await this.db.outbox.update({
                where: { id: task.id },
                data: { status: 'COMPLETED', finishedAt: new Date() }
            });

            this.logger.log(`✅ Tarea ${task.id} procesada exitosamente.`);

        } catch (error: any) {
            this.logger.error(`⚠️ Fallo en la tarea ${task.id}: ${error.message}`);

            // Lógica de reintentos
            const attempts = task.attempts + 1;
            if (attempts >= 5) {
                await this.db.outbox.update({
                    where: { id: task.id },
                    data: { status: 'FAILED', error: error.message }
                });
            } else {
                await this.db.outbox.update({
                    where: { id: task.id },
                    data: { status: 'PENDING', attempts: attempts }
                });
            }
        }
    }
}