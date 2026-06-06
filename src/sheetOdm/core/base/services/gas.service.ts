import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class GasService {
    private readonly logger = new Logger(GasService.name);
    private readonly webappUrl: string;
    private readonly apiKey: string;

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) {
        this.webappUrl = this.configService.get<string>('GAS_WEBAPP_URL');
        this.apiKey = this.configService.get<string>('GAS_API_KEY');

        if (!this.webappUrl || !this.apiKey) {
            throw new Error('Las variables de entorno GAS_WEBAPP_URL y GAS_API_KEY son obligatorias.');
        }
    }

    /**
     * Ejecuta una petición HTTP hacia GAS con lógica robusta de reintentos
     */
    private async requestWithRetry<T>(params: Record<string, any>, retries = 2, delay = 1000): Promise<T | null> {
        try {
            const response = await firstValueFrom(
                this.httpService.get('', {
                    baseURL: this.webappUrl,
                    timeout: 10000, // Timeout estricto de 10 segundos
                    params: { token: this.apiKey, ...params },
                }),
            );

            if (response.data?.error) {
                throw new Error(`GAS_INTERNAL_ERROR: ${response.data.error}`);
            }

            return response.data?.data as T;
        } catch (error) {
            const isNetworkOrTimeout =
                error.code === 'ECONNABORTED' ||
                !error.response ||
                (error.response && error.response.status >= 500);

            if (retries > 0 && isNetworkOrTimeout) {
                this.logger.warn(`Fallo de conexión con Google Sheets. Reintentando en ${delay}ms... (${retries} intentos restantes)`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                return this.requestWithRetry<T>(params, retries - 1, delay * 2);
            }

            this.logger.error(`Error definitivo en la petición a GAS: ${error.message}`);
            throw new HttpException(
                'Error de comunicación con el motor de persistencia de Google.',
                HttpStatus.BAD_GATEWAY,
            );
        }
    }

    /**
     * Busca un único documento usando el índice de Google Sheets
     */
    async findOne<T>(sheet: string, column: string, value: string): Promise<T | null> {
        return this.requestWithRetry<T>({ action: 'findOne', sheet, column, value });
    }

    /**
     * Filtra múltiples documentos en memoria de forma optimizada
     */
    async findMany<T>(sheet: string, column: string, value: string): Promise<T[]> {
        return this.requestWithRetry<T[]>({ action: 'findMany', sheet, column, value }) || [];
    }

    /**
     * Método Populate nativo en la RAM de Fly.io (Evita Timeouts de Google)
     * Resuelve relaciones 1:1 o 1:N cruzando datos en memoria
     */
    populate<T, R>(docs: T | T[], foreignData: R[], foreignKey: keyof R, localKey: keyof T, isMany = false): T | T[] {
        if (!docs) return docs;
        const isArray = Array.isArray(docs);
        const docList = isArray ? docs : [docs];

        // Construcción del Mapa en memoria en Fly.io (Complejidad O(M))
        const foreignMap = new Map<string, any>();
        for (const row of foreignData) {
            const keyVal = String(row[foreignKey]).toLowerCase().trim();
            if (isMany) {
                if (!foreignMap.has(keyVal)) foreignMap.set(keyVal, []);
                foreignMap.get(keyVal).push(row);
            } else {
                foreignMap.set(keyVal, row);
            }
        }

        // Hidratación in-memory (Complejidad O(N))
        docList.forEach((doc) => {
            const joinValue = String(doc[localKey]).toLowerCase().trim();
            const propName = `${String(foreignKey).toLowerCase()}_relation`;
            doc[propName] = foreignMap.get(joinValue) || (isMany ? [] : null);
        });

        return isArray ? docList : docList[0];
    }
}