import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { CategoriaEntity } from '../entities/CategoriaEntity';
import { CreateDetallePlanillaDto, DetallePlanillaEntity } from '../entities/DetallePlanillaEntity';
import { ObreroEntity } from '../entities/ObreroEntity';
import { AdelantoEntity } from '../entities/AdelantoEntity';
import { AsistenciaDiariaEntity } from '../entities/AsistenciaDiariaEntity';
import { InjectModel, SheetsRepository } from '@sheetOdm/index';


@Injectable()
export class PlanillaTareoService {
    private readonly logger = new Logger(PlanillaTareoService.name);

    constructor(
        // Cambia el tipo inyectado por el token específico
        @Inject('CategoriaEntityRepository')
        private readonly repo: any,
        @Inject('ObreroEntityRepository')
        private readonly obreroRepository: SheetsRepository<ObreroEntity>,
        @Inject('DetallePlanillaEntityRepository')
        private readonly detallePlanillaRepository: SheetsRepository<DetallePlanillaEntity>
    ) { }

    /**
     * 1. Crear Categoría Tarifaria (Maestro)
     */
    async crearCategoria(dto: CategoriaEntity) {
        if (!dto.id) {
            throw new Error("El ID de la categoría es obligatorio para la operación.");
        }
        const doc = await this.repo.create1(dto);
        return { message: 'Categoría creada correctamente en Sheets' };
    }

    async createObreroConAdelantos(data: any): Promise<ObreroEntity> {
        // Aquí podrías añadir validación adicional o transformación de DTO a Entidad
        const obrero = new ObreroEntity();
        obrero.nombre = data.nombre;
        obrero.dni = data.dni;
        obrero.idCategoriaActual = data.idCategoriaActual;
        obrero.saldoEfectivoArrastrado = data.saldoEfectivoArrastrado || 0;

        // Mapeamos los adelantos si existen
        if (data.adelantos) {
            obrero.adelantos = data.adelantos.map((a: any) => ({
                monto: a.monto,
                fecha: a.fecha,
                idPlanilla: a.idPlanilla,
                motivo: a.motivo
            }));
        }

        // Llamamos al método que implementamos: save1
        return await this.obreroRepository.save1(obrero);
    }

    async createDetalle(dto: CreateDetallePlanillaDto): Promise<any> {
        // 1. Transformamos el DTO a Entidad
        const detalle = Object.assign(new DetallePlanillaEntity(), dto);

        // 2. Persistimos (esto usará tu lógica de ID generado y mapeo)
        const saved = await this.detallePlanillaRepository.save1(detalle);

        // 3. Retornamos incluyendo los cálculos de los Getters
        // Usamos spread para incluir los resultados de los métodos getter
        return {
            ...saved,
            calculos: {
                bolsaTotalHorasExtras: detalle.bolsaTotalHorasExtras,
                montoJornadaNormal: detalle.montoJornadaNormal,
                montoHorasExtrasBolsa: detalle.montoHorasExtrasBolsa,
                salarioNetoCalculado: detalle.salarioNetoCalculado,
                saldoPendiente: detalle.saldoEfectivoPendienteProximaSemana,
                deudaHoras: detalle.deudaHorasProximaSemana
            }
        };
    }


}