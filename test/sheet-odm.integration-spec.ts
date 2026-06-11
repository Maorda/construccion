import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/sheetOdm/services/prisma.service';
import { OutboxProcessor } from '../src/sheetOdm/core/outbox/OutboxProcessor';
import { PrismaOutboxService } from '../src/sheetOdm/core/outbox/PrismaOutboxService';
import { GoogleAutenticarService } from '../src/sheetOdm/services/auth.google.service';
import { OutboxStatus, TypeOp } from '../src/sheetOdm/core/outbox/OutboxEntry';

describe('SheetODM - Pruebas de Integración (Outbox + Prisma)', () => {
    let prisma: PrismaService;
    let outboxProcessor: OutboxProcessor;
    let mockGoogleAuthService: any;

    // 1. Crear un Mock controlado de la API de Google Sheets
    const mockPushToSheet = jest.fn().mockResolvedValue({ success: true });

    beforeAll(async () => {
        mockGoogleAuthService = {
            sheets: {
                pushToSheet: mockPushToSheet
            }
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            providers: [
                PrismaService,
                PrismaOutboxService,
                OutboxProcessor,
                {
                    provide: GoogleAutenticarService,
                    useValue: mockGoogleAuthService // Inyectamos el mock para no tocar la API real
                },
                {
                    provide: 'DATABASE_OPTIONS',
                    useValue: { outboxPollingInterval: 1000 } // Intervalo corto para pruebas (1s)
                }
            ],
        }).compile();

        prisma = moduleFixture.get<PrismaService>(PrismaService);
        outboxProcessor = moduleFixture.get<OutboxProcessor>(OutboxProcessor);

        // Conectar a la BD de pruebas antes de empezar
        await prisma.$connect();
    });

    beforeEach(async () => {
        // Limpiar la tabla outbox antes de cada prueba para tener un entorno aislado
        await prisma.outboxEntry.deleteMany({});
        jest.clearAllMocks();
    });

    afterAll(async () => {
        // Apagado elegante del procesador y desconexión de BD
        if (outboxProcessor) {
            (outboxProcessor as any).onApplicationShutdown();
        }
        await prisma.$disconnect();
    });

    it('Debe registrar transacciones en la BD y el OutboxProcessor debe procesarlas con éxito', async () => {
        const outboxService = new PrismaOutboxService(prisma);

        // SIMULACIÓN: Lo que haría tu motor de persistencia al guardar datos
        const entradasDummy = [
            {
                id: '1',
                entityName: 'User',
                sheetName: 'Usuarios',
                operation: TypeOp.INSERT,
                status: OutboxStatus.PENDING,
                payload: { name: 'Goku', email: 'goku@test.com' },
                attempts: 0,
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ];

        // 2. Ejecutar la acción: Guardar en la transacción de Prisma
        await outboxService.saveTransaction(entradasDummy as any);

        // Verificación intermedia: ¿Se guardó en la BD con estado PENDING?
        const registrosEnBD = await prisma.outboxEntry.findMany();
        expect(registrosEnBD).toHaveLength(1);
        expect(registrosEnBD[0].status).toBe(OutboxStatus.PENDING);

        // 3. Forzar manualmente una vuelta del procesador (processOutbox) para evaluar el flujo
        // Nota: Accedemos al método privado de manera segura para la prueba
        await (outboxProcessor as any).processOutbox();

        // 4. VERIFICACIONES DE LA VERDAD:

        // A. ¿Se llamó a la función simulada de Google Sheets con los parámetros correctos?
        expect(mockPushToSheet).toHaveBeenCalledWith('Usuarios', { name: 'Goku', email: 'goku@test.com' });

        // B. ¿El procesador actualizó el estado en la BD local a COMPLETED?
        const registroProcesado = await prisma.outboxEntry.findUnique({
            where: { id: registrosEnBD[0].id }
        });
        expect(registroProcesado?.status).toBe(OutboxStatus.COMPLETED);
        expect(registroProcesado?.finishedAt).toBeInstanceOf(Date);
    });
});