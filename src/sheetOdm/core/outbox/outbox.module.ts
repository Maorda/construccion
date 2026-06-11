import { Module } from "@nestjs/common";

import { GoogleAutenticarService } from "@sheetOdm/services/auth.google.service.js";
import { OutboxService } from "./OutboxEntry.js";
import { PrismaOutboxService } from "./PrismaOutboxService.js";
import { PrismaService } from "@sheetOdm/services/prisma.service.js";
import { OutboxProcessor } from "./OutboxProcessor.js";


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