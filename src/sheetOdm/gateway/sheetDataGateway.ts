// sheet-data.gateway.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { GasService } from '@sheetOdm/core/base/services/gas.service.js';
import { GoogleAutenticarService } from '@sheetOdm/services/auth.google.service.js';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service.js';
import { ClassType, ISheetDriver } from '@sheetOdm/types/query.types.js';


@Injectable()
export class SheetDataGateway implements ISheetDriver {
    private readonly logger = new Logger(SheetDataGateway.name);

    constructor(
        private readonly auth: GoogleAutenticarService,
        @Inject('SPREADSHEET_ID') private readonly spreadsheetId: string,
        private readonly metadataRegistry: MetadataRegistry,
        private readonly gas: GasService,
    ) { }
    // 🟢 LAS LECTURAS VAN POR GAS (Aprovecha tus índices y búsqueda binaria)
    async findOne<T>(sheet: string, column: string, value: string): Promise<T | null> {
        return this.gas.findOne<T>(sheet, column, value);
    }

    async findMany<T>(sheet: string, column: string, value: string): Promise<T[]> {
        return this.gas.findMany<T>(sheet, column, value);
    }
    async createSheet(title: string): Promise<any> {
        return await this.auth.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: { requests: [{ addSheet: { properties: { title } } }] }
        });
    }

    async writeHeaders(sheetName: string, headers: string[]): Promise<void> {
        await this.auth.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'RAW',
            requestBody: { values: [headers] }
        });
    }

    async appendRow(sheetName: string, row: any[]): Promise<number> {
        try {
            const response = await this.auth.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A:A`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [row] },
            });

            const updatedRange = response.data?.updates?.updatedRange; // Ej: "OBREROS!A15:O15"

            if (updatedRange) {
                const match = updatedRange.match(/\d+$/);
                if (match) {
                    return parseInt(match[0], 10);
                }
            }
            throw new Error(`No se pudo determinar la fila física insertada en ${sheetName}`);
        } catch (error: any) {
            this.logger.error(`Error en appendRow para ${sheetName}: ${error.message}`);
            throw error;
        }
    }
    async appendRows(sheetName: string, rows: any[][]): Promise<number[]> {
        if (!rows || rows.length === 0) return [];
        try {
            const response = await this.auth.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A:A`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: rows },
            });

            const updatedRange = response.data?.updates?.updatedRange; // Ej: "OBREROS!A15:O17" o "OBREROS!A15:O15"

            if (updatedRange) {
                const parts = updatedRange.split('!');
                const rangePart = parts[1] || parts[0]; // "A15:O17"
                const matches = rangePart.match(/\d+/g); // Extrae ["15", "17"]

                if (matches) {
                    const startRow = parseInt(matches[0], 10);
                    const endRow = matches[1] ? parseInt(matches[1], 10) : startRow;

                    const indices: number[] = [];
                    for (let i = startRow; i <= endRow; i++) {
                        indices.push(i);
                    }
                    return indices; // Retorna un array ordenado de filas físicas asignadas [15, 16, 17]
                }
            }
            throw new Error(`No se pudo determinar el rango físico insertado en ${sheetName}`);
        } catch (error: any) {
            this.logger.error(`❌ Error en appendRows para ${sheetName}: ${error.message}`);
            throw error;
        }
    }

    async getExistingSheetTitles(): Promise<string[]> {
        const res = await this.auth.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
        return res.data.sheets?.map(s => s.properties?.title) || [];
    }

    async getRange(range: string): Promise<any[][]> {
        const res = await this.auth.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: range,
            valueInputOption: 'RAW',
        });
        return res.data.values || [];
    }

    async updateRow(sheetName: string, rowNumber: number, values: any[]): Promise<number> {
        try {
            await this.auth.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                // Seteamos desde la columna A de esa fila en adelante
                range: `${sheetName}!A${rowNumber}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [values] },
            });
            return rowNumber;
        } catch (error: any) {
            this.logger.error(`Error en updateRow en ${sheetName} (Fila ${rowNumber}): ${error.message}`);
            throw error;
        }
    }

    /**
     * 🔥 REFACTORIZADO: Usa limpieza por fila completa sin limitar a la columna Z
     */
    async clearRow(sheetName: string, rowNumber: number): Promise<void> {
        try {
            await this.auth.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                // Rango nativo de Google Sheets para limpiar toda la fila
                range: `${sheetName}!${rowNumber}:${rowNumber}`,
            });
        } catch (error: any) {
            this.logger.error(`Error en clearRow para ${sheetName} en fila ${rowNumber}: ${error.message}`);
            throw error;
        }
    }

    /**
     * 🔥 REFACTORIZADO: Trae los datos reales optimizados por Google Sheets
     */
    async getRowData(sheetName: string, rowNumber: number): Promise<any[]> {
        // Al pasar fila:fila, Google solo devuelve las celdas pobladas del layout
        const range = `${sheetName}!${rowNumber}:${rowNumber}`;
        const values = await this.getRange(range);
        return values[0] || [];
    }

    getDocId<T extends object>(entityClass: ClassType<T>, rowData: any[]): any {
        const pkField = this.metadataRegistry.getPrimaryKeyField(entityClass);
        const columnMap = this.metadataRegistry.getColumnMap(entityClass);
        const index = columnMap[pkField];
        return rowData[index];
    }
    async batchUpdateValues(data: { range: string; values: any[][] }[]): Promise<void> {
        try {
            if (data.length === 0) return;

            await this.auth.sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: data.map(item => ({
                        range: item.range,
                        values: item.values
                    }))
                }
            });
            this.logger.log(`[Gateway] ⚡ Batch Update completado con éxito. Rupturas de cuota evitadas.`);
        } catch (error: any) {
            this.logger.error(`Error en batchUpdateValues: ${error.message}`);
            throw error;
        }
    }
    /**
     * 🔥 NUEVO: Limpia (borra celdas) de múltiples rangos/filas a la vez
     */
    async batchClearValues(ranges: string[]): Promise<void> {
        try {
            if (ranges.length === 0) return;

            await this.auth.sheets.spreadsheets.values.batchClear({
                spreadsheetId: this.spreadsheetId,
                requestBody: { ranges }
            });
            this.logger.log(`[Gateway] 🧼 Batch Clear ejecutado para ${ranges.length} rangos.`);
        } catch (error: any) {
            this.logger.error(`Error en batchClearValues: ${error.message}`);
            throw error;
        }
    }

}
