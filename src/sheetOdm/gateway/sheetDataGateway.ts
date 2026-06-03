// sheet-data.gateway.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { GoogleAutenticarService } from '@sheetOdm/services/auth.google.service';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { ClassType, ISheetDriver } from '@sheetOdm/types/query.types';


@Injectable()
export class SheetDataGateway implements ISheetDriver {
    private readonly logger = new Logger(SheetDataGateway.name);

    constructor(
        private readonly auth: GoogleAutenticarService,
        @Inject('SPREADSHEET_ID') private readonly spreadsheetId: string,
        private readonly metadataRegistry: MetadataRegistry,
    ) { }
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
}
