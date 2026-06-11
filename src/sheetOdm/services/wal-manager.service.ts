import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GasService } from '@sheetOdm/core/base/services/gas.service.js';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { MetadataRegistry } from './metadata-registry.service.js';
// Asumo la existencia de tu servicio GAS inyectable


export interface WalRecord {
    txId: string;
    sheetName: string;
    action: 'insert' | 'update' | 'delete';
    pkColumn: string; // 🔥 Agregado: Necesitamos saber cuál es la columna PK (ej: 'id', 'dni')
    entityId: string;
    payload: any;
    status: 'PENDING' | 'COMPLETED';
    timestamp: number;
}

@Injectable()
export class WalManagerService implements OnModuleInit {
    private readonly logger = new Logger(WalManagerService.name);
    private readonly walFilePath = path.join(process.cwd(), 'odm-transactions.log');

    // 🔥 Reemplazamos SheetDataGateway por GasService para la recuperación lógica
    constructor(private readonly gasService: GasService,
        private readonly metadataRegistry: MetadataRegistry
    ) { }

    async onModuleInit() {
        this.logger.log('[WAL] Iniciando motor WAL. Buscando operaciones pendientes...');
        await this.recoverPendingOperations();
    }

    public async logIntent(tx: Omit<WalRecord, 'status' | 'timestamp'>): Promise<void> {
        const record: WalRecord = {
            ...tx,
            status: 'PENDING',
            timestamp: Date.now()
        };
        const line = JSON.stringify(record) + '\n';
        await fs.promises.appendFile(this.walFilePath, line, 'utf8');
    }

    public async markCompleted(txId: string): Promise<void> {
        const record = { txId, status: 'COMPLETED', timestamp: Date.now() };
        const line = JSON.stringify(record) + '\n';
        await fs.promises.appendFile(this.walFilePath, line, 'utf8');
    }

    private async recoverPendingOperations() {
        if (!fs.existsSync(this.walFilePath)) return;

        const pendingTransactions = new Map<string, WalRecord>();

        const fileStream = fs.createReadStream(this.walFilePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const data = JSON.parse(line);
                if (data.status === 'COMPLETED') {
                    pendingTransactions.delete(data.txId);
                } else {
                    pendingTransactions.set(data.txId, data as WalRecord);
                }
            } catch (err) {
                this.logger.error(`[WAL] Log corrupto detectado y saltado: ${line}`);
            }
        }

        if (pendingTransactions.size === 0) {
            await fs.promises.writeFile(this.walFilePath, '', 'utf8');
            return;
        }

        this.logger.warn(`[WAL] ⚠️ Se encontraron ${pendingTransactions.size} transacciones interrumpidas. Iniciando recuperación idempotente...`);

        // Procesamiento secuencial para garantizar integridad referencial durante la recuperación
        for (const [txId, tx] of pendingTransactions) {
            await this.resolveIdempotentTransaction(tx);
        }

        await fs.promises.writeFile(this.walFilePath, '', 'utf8');
        this.logger.log('[WAL] ✅ Recuperación finalizada. Archivo de log purgado.');
    }

    /**
     * PASO 4: Resolución Inteligente e Idempotente.
     * Recupera el estado real de la hoja y reconcilia el payload pendiente.
     */
    private async resolveIdempotentTransaction(tx: WalRecord) {
        this.logger.log(`[WAL] Resolviendo transacción atascada [${tx.action}] para PK: ${tx.entityId}`);

        try {
            // 1. Obtener la entidad para resolver el nombre físico de la columna PK
            // Esto es necesario porque el GAS necesita el nombre real en la hoja (ej: "ID_USUARIO")
            const entityClass = this.metadataRegistry.getEntityBySheetName(tx.sheetName);
            if (!entityClass) {
                throw new Error(`No se encontró entidad registrada para la hoja: ${tx.sheetName}`);
            }

            // 2. Consulta al motor de Apps Script (Búsqueda Binaria Rápida)
            const remoteDoc = await this.gasService.findOne<any>(tx.sheetName, tx.pkColumn, tx.entityId);

            if (tx.action === 'insert') {
                if (remoteDoc) {
                    this.logger.debug(`[WAL] El registro ${tx.entityId} ya existe. Ignorando insert duplicado.`);
                    return;
                } else {
                    this.logger.log(`[WAL] El registro ${tx.entityId} no existe. Reintentando insert...`);
                    await this.gasService.insert(tx.sheetName, tx.payload);
                }
            }

            if (tx.action === 'update') {
                if (!remoteDoc) {
                    this.logger.error(`[WAL] Update fallido: Registro ${tx.entityId} no encontrado en ${tx.sheetName}.`);
                    return;
                }

                // --- Optimistic Concurrency Control (OCC) ---
                const localVersion = tx.payload.version !== undefined ? parseInt(tx.payload.version, 10) : 0;
                const remoteVersion = remoteDoc.version !== undefined ? parseInt(remoteDoc.version, 10) : 0;

                if (remoteVersion >= localVersion && localVersion !== 0) {
                    this.logger.debug(`[WAL] Registro ${tx.entityId} ya actualizado (V.${remoteVersion}). Ignorando.`);
                    return;
                }

                this.logger.log(`[WAL] Ejecutando update atascado para ${tx.entityId}...`);

                // --- Inyección del _row físico ---
                // El GAS requiere el _row para saber exactamente qué fila editar en la hoja.
                const updatePayload = {
                    ...tx.payload,
                    _row: remoteDoc._row
                };

                await this.gasService.update(tx.sheetName, updatePayload);
            }

            if (tx.action === 'delete') {
                this.logger.log(`[WAL] Procesando delete lógico para ${tx.entityId}...`);

                // El remoteDoc ya contiene el _row gracias a la búsqueda findOne previa
                if (remoteDoc && remoteDoc._row) {
                    await this.gasService.delete(tx.sheetName, remoteDoc._row);
                } else {
                    this.logger.warn(`[WAL] No se pudo encontrar el _row para borrar el registro ${tx.entityId}`);
                }
            }

            // 3. Si todo salió bien, marcamos como completado para purgar del log
            await this.markCompleted(tx.txId);
            this.logger.log(`[WAL] Transacción ${tx.txId} resuelta con éxito.`);

        } catch (error: any) {
            this.logger.error(`[WAL] ❌ Fallo crítico al recuperar la transacción ${tx.txId}: ${error.message}`);
            // No marcamos como completado, permitiendo que el sistema intente de nuevo en el siguiente inicio
            throw error;
        }
    }
}