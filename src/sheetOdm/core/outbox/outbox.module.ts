import { Module } from "@nestjs/common";

import { GoogleAutenticarService } from "@sheetOdm/services/auth.google.service";
import { OutboxService } from "./OutboxEntry";
import { PrismaOutboxService } from "./PrismaOutboxService";
import { PrismaService } from "@sheetOdm/services/prisma.service";
import { OutboxProcessor } from "./OutboxProcessor";


@Module({
    imports: [

    ],
    providers: [
        GoogleAutenticarService, // Provee GoogleAutenticarService
        PrismaService, // 🟢 Lo registras directamente aquí como provider interno
        OutboxProcessor,
        {
            provide: OutboxService,
            useClass: PrismaOutboxService
        }
    ],
    exports: [
        OutboxProcessor,
        OutboxService
    ]
})
export class OutboxModule { }