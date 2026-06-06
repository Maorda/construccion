import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Inyecta tu servicio que se comunica con GAS
import { GoogleSheetsApiService } from './google-sheets-api.service';

export interface WalRecord {
    txId: string;
    sheetName: string;
    action: 'insert' | 'update' | 'delete';
    entityId: string; // El UUID de tu entidad
    payload: any;
    status: 'PENDING' | 'COMPLETED';
    timestamp: number;
}

@Injectable()
export class WalManagerService implements OnModuleInit {
    private readonly logger = new Logger(WalManagerService.name);
    private readonly walFilePath = path.join(process.cwd(), 'odm-transactions.log');

    constructor(private readonly sheetsApi: GoogleSheetsApiService) { }

    async onModuleInit() {
        this.logger.log('Iniciando motor WAL. Buscando operaciones pendientes...');
        await this.recoverPendingOperations();
    }

    /**
     * PASO 1: Registrar la intención ANTES de llamar a Google API.
     */
    public async logIntent(tx: Omit<WalRecord, 'status'>): Promise<void> {
        const record: WalRecord = { ...tx, status: 'PENDING' };
        const line = JSON.stringify(record) + '\n';
        await fs.promises.appendFile(this.walFilePath, line, 'utf8');
    }

    /**
     * PASO 2: Marcar como completado SOLO cuando Google responde HTTP 200 OK.
     */
    public async markCompleted(txId: string): Promise<void> {
        // En lugar de borrar la línea (lo cual es lento), añadimos un evento de completado.
        const record = { txId, status: 'COMPLETED', timestamp: Date.now() };
        const line = JSON.stringify(record) + '\n';
        await fs.promises.appendFile(this.walFilePath, line, 'utf8');
    }

    /**
     * PASO 3: Recuperación ante Desastres (Ejecutado al iniciar NestJS)
     */
    private async recoverPendingOperations() {
        if (!fs.existsSync(this.walFilePath)) return;

        const pendingTransactions = new Map<string, WalRecord>();

        // Leemos el archivo eficientemente línea por línea
        const fileStream = fs.createReadStream(this.walFilePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        for await (const line of rl) {
            if (!line.trim()) continue;
            const data = JSON.parse(line);

            if (data.status === 'COMPLETED') {
                pendingTransactions.delete(data.txId);
            } else {
                pendingTransactions.set(data.txId, data as WalRecord);
            }
        }

        if (pendingTransactions.size === 0) {
            // Si todo está limpio, truncamos el log para que no crezca infinitamente
            await fs.promises.writeFile(this.walFilePath, '', 'utf8');
            return;
        }

        this.logger.warn(`⚠️ Se encontraron ${pendingTransactions.size} transacciones interrumpidas. Iniciando recuperación idempotente...`);

        for (const [txId, tx] of pendingTransactions) {
            await this.resolveIdempotentTransaction(tx);
        }

        // Limpiamos el archivo una vez superada la crisis
        await fs.promises.writeFile(this.walFilePath, '', 'utf8');
        this.logger.log('✅ Recuperación finalizada. Archivo de log purgado.');
    }

    /**
     * PASO 4: Resolución Inteligente (Evita Duplicados)
     */
    private async resolveIdempotentTransaction(tx: WalRecord) {
        this.logger.log(`Resolviendo transacción atascada [${tx.action}] para ID: ${tx.entityId}`);

        try {
            // 1. Preguntamos a GAS si el registro YA EXISTE
            // Hacemos uso del findOne que escribimos en GAS
            const remoteDoc = await this.sheetsApi.findOne(tx.sheetName, 'id', tx.entityId);

            if (tx.action === 'insert') {
                if (remoteDoc) {
                    // El servidor se cayó DESPUÉS de que Google guardara. ¡Es un falso error!
                    this.logger.debug(`El registro ${tx.entityId} ya existe en Google Sheets. Ignorando insert duplicado.`);
                    return;
                } else {
                    // El servidor se cayó ANTES de llegar a Google. Hay que insertarlo.
                    this.logger.log(`El registro ${tx.entityId} NO existe. Reintentando insert...`);
                    await this.sheetsApi.insert(tx.sheetName, tx.payload);
                }
            }

            if (tx.action === 'update') {
                // Aquí aplicamos el Optimistic Concurrency Control
                if (remoteDoc && remoteDoc.version >= tx.payload.version) {
                    this.logger.debug(`El registro ${tx.entityId} ya tiene la versión más reciente. Ignorando update.`);
                    return;
                } else {
                    this.logger.log(`Reintentando update para ${tx.entityId}...`);
                    await this.sheetsApi.update(tx.sheetName, tx.payload);
                }
            }

        } catch (error: any) {
            this.logger.error(`Fallo crítico al recuperar la transacción ${tx.txId}: ${error.message}`);
            // En un entorno productivo real, aquí podrías enviar un evento a Sentry o a una Dead Letter Queue.
        }
    }
}