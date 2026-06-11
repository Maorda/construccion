import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);

    constructor() {
        // 1. Obtenemos la URL de conexión desde tu entorno
        const connectionString = process.env.DATABASE_URL;

        // 2. Creamos el Pool de conexiones nativo de Node Postgres (pg)
        const pool = new Pool({ connectionString });

        // 3. Envolvemos el Pool en el adaptador oficial de Prisma
        const adapter = new PrismaPg(pool);

        // 4. Inyectamos el adaptador en el constructor padre
        super({
            adapter,
            log: ['warn', 'error'],
        });
    }

    async onModuleInit() {
        try {
            await this.$connect();
            this.logger.log('📦 Conectado a Postgres vía Prisma Adapter exitosamente.');
        } catch (error) {
            this.logger.error('❌ Error al conectar con la base de datos.', error);
            throw error;
        }
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}