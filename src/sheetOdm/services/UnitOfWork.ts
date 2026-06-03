import { Injectable, Scope, Logger } from '@nestjs/common';
import { ClassType } from '@sheetOdm/types/query.types';
import { SheetDocument } from '@sheetOdm/wrapper/sheetDocument';
import { ModuleRef } from '@nestjs/core';
import { getRepositoryToken } from '@sheetOdm/utils/helper';

export interface PendingOperation {
    type: 'INSERT' | 'UPDATE' | 'DELETE';
    entityClass: Function;
    sheetName: string;
    doc: SheetDocument<any>;
}

@Injectable({ scope: Scope.REQUEST })
export class UnitOfWork {
    private readonly logger = new Logger(UnitOfWork.name);
    private readonly identityMap = new Map<string, SheetDocument<any>>();
    private pendingOperations: PendingOperation[] = [];
    private isTransactional = false;

    // Inyectamos ModuleRef para resolver los repositorios correspondientes bajo demanda
    constructor(private readonly moduleRef: ModuleRef) { }

    private getCompositeKey(entityClass: ClassType<any>, pk: string | number): string {
        return `${entityClass.name}:${pk}`;
    }

    public register(doc: SheetDocument<any>, pk: string | number, entityClass: ClassType<any>) {
        const key = this.getCompositeKey(entityClass, pk);
        if (!this.identityMap.has(key)) {
            this.identityMap.set(key, doc);
        }
    }

    public get(pk: string | number, entityClass: ClassType<any>): SheetDocument<any> | undefined {
        return this.identityMap.get(this.getCompositeKey(entityClass, pk));
    }

    public getAll(): SheetDocument<any>[] {
        return Array.from(this.identityMap.values());
    }

    // --- CONTROL DE TRANSACCIONES ---
    public startTransaction() {
        this.isTransactional = true;
        this.pendingOperations = [];
        this.logger.debug('[UOW] 🏁 Transacción iniciada en contexto de Request.');
    }

    public queueOperation(operation: PendingOperation) {
        if (!this.isTransactional) {
            return false;
        }
        this.pendingOperations.push(operation);
        this.logger.debug(`[UOW] 📥 Encolada operación ${operation.type} para [${operation.sheetName}]`);
        return true;
    }

    public hasActiveTransaction(): boolean {
        return this.isTransactional;
    }

    public getPendingOperations() {
        return this.pendingOperations;
    }

    /**
     * 🔥 NUEVO: Realiza el volcado atómico agrupado hacia los repositorios expertos
     */
    public async commit(): Promise<void> {
        if (!this.isTransactional) {
            this.logger.warn('[UOW] ⚠️ Intentando hacer commit sin una transacción activa.');
            return;
        }

        if (this.pendingOperations.length === 0) {
            this.logger.debug('[UOW] 💤 No hay operaciones pendientes en la cola. Commit omitido.');
            this.isTransactional = false;
            return;
        }

        this.logger.log(`[UOW] 🚀 Iniciando Commit Físico de ${this.pendingOperations.length} operaciones...`);

        // 1. Agrupar las operaciones por clase de Entidad
        const groups = new Map<Function, PendingOperation[]>();
        for (const op of this.pendingOperations) {
            if (!groups.has(op.entityClass)) {
                groups.set(op.entityClass, []);
            }
            groups.get(op.entityClass)!.push(op);
        }

        try {
            // 2. Ejecutar de forma secuencial controlada por repositorio para proteger FKs jerárquicas
            for (const [entityClass, ops] of groups.entries()) {
                const repoToken = getRepositoryToken(entityClass);
                const repo = this.moduleRef.get<any>(repoToken, { strict: false });

                if (!repo || typeof repo.commitBulk !== 'function') {
                    throw new Error(`El repositorio para ${entityClass.name} no está registrado o no implementa commitBulk().`);
                }

                this.logger.debug(`[UOW] 📭 Enviando ${ops.length} operaciones en lote al repositorio [${repo.sheetName}]`);
                await repo.commitBulk(ops);
            }

            this.logger.log('🎉 [UOW] ¡Commit masivo completado con éxito en Google Sheets!');

            // 3. Limpiar estado transaccional tras éxito
            this.pendingOperations = [];
            this.isTransactional = false;

        } catch (error: any) {
            this.logger.error(`❌ [UOW Commit Error] Falló el volcado masivo: ${error.message}`);
            this.rollback(); // Limpieza de seguridad ante errores de red o cuota API
            throw error;
        }
    }

    public rollback() {
        this.pendingOperations = [];
        this.isTransactional = false;
        this.logger.warn('[UOW] 🔄 Transacción abortada. Cola de operaciones limpiada.');
    }

    public clear() {
        this.identityMap.clear();
        this.pendingOperations = [];
        this.isTransactional = false;
    }

    public clearByEntity(entityClass: ClassType<any>) {
        const prefix = `${entityClass.name}:`;
        for (const key of this.identityMap.keys()) {
            if (key.startsWith(prefix)) this.identityMap.delete(key);
        }
    }
}