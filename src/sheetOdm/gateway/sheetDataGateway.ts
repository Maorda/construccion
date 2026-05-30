// sheet-data.gateway.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { ISheetDriver } from '@sheetOdm/core/interfaces/sheet-driver.interface';
import { GoogleAutenticarService } from '@sheetOdm/services/auth.google.service';


@Injectable()
export class SheetDataGateway implements ISheetDriver {
    private readonly logger = new Logger(SheetDataGateway.name);

    constructor(
        private readonly auth: GoogleAutenticarService,
        @Inject('SPREADSHEET_ID') private readonly spreadsheetId: string
    ) { }

    // Acciones de infraestructura pura
    async createSheet(title: string) {
        return await this.auth.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: { requests: [{ addSheet: { properties: { title } } }] }
        });
    }

    // Acciones de datos pura
    async writeHeaders(sheetName: string, headers: string[]) {
        await this.auth.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'RAW',
            requestBody: { values: [headers] }
        });
    }
    async appendRow(sheetName: string, row: any[]): Promise<number> {
        try {
            // Tu llamada actual a la API de Google
            const response = await this.auth.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A:A`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [row] },
            });

            // 🎯 Extraemos el rango actualizado directamente desde la respuesta real de Google
            const updatedRange = response.data?.updates?.updatedRange; // Ej: "DETALLES_PLANILLA!A15:O15"

            if (updatedRange) {
                const match = updatedRange.match(/\d+$/); // Captura el último número del rango (la fila)
                if (match) {
                    return parseInt(match[0], 10); // Retorna ej: 15
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

    // En SheetDataGateway.ts
    async getRange(range: string): Promise<any[][]> {
        const res = await this.auth.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: range,
            valueInputOption: 'RAW', // O 'USER_ENTERED' según convenga
        });
        return res.data.values || [];
    }
    async updateRow(sheetName: string, rowNumber: number, values: any[]) {
        try {
            // En Google Sheets, apuntamos directamente a la fila exacta usando el rango A{rowNumber}
            await this.auth.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A${rowNumber}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [values] },
            });

            // 🎯 Devolvemos consistentemente el número de fila modificado
            return rowNumber;
        } catch (error: any) {
            this.logger.error(`Error en updateRow para ${sheetName} en fila ${rowNumber}: ${error.message}`);
            throw error;
        }
    }
    async clearRow(sheetName: string, rowNumber: number): Promise<void> {
        try {
            await this.auth.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A${rowNumber}:Z${rowNumber}`, // Asumimos un ancho de 26 columnas (A-Z)
            });
        } catch (error: any) {
            this.logger.error(`Error en clearRow para ${sheetName} en fila ${rowNumber}: ${error.message}`);
            throw error;
        }
    }
}