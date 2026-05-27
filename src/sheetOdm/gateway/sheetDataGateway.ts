// sheet-data.gateway.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { GoogleAutenticarService } from '@sheetOdm/services/auth.google.service';


@Injectable()
export class SheetDataGateway {
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
    async appendRow(sheetName: string, values: any[]) {
        await this.auth.sheets.spreadsheets.values.append({
            spreadsheetId: this.spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [values] }
        });
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
}