import { Injectable } from "@nestjs/common";
import { OutboxEntry, OutboxService } from "@sheetOdm/core/outbox/OutboxEntry";
import { PrismaService } from "@sheetOdm/services/prisma.service";


@Injectable()
export class PrismaOutboxService implements OutboxService {
    constructor(private readonly prisma: PrismaService) { }

    async saveTransaction(entries: OutboxEntry[]): Promise<void> {
        // Usamos $transaction de Prisma para garantizar Atomicidad total
        await this.prisma.$transaction(
            entries.map((entry) =>
                this.prisma.outboxEntry.create({
                    data: {
                        operation: entry.operation, // 🟢 CORREGIDO: Usamos 'operation' para que coincida con Prisma
                        entityName: entry.entityName,
                        sheetName: entry.sheetName,
                        payload: entry.payload,
                        status: entry.status,
                    }
                })
            )
        );
    }
}