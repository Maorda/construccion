import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { CategoriaEntity } from '../entities/CategoriaEntity';
import { CreateDetallePlanillaDto, DetallePlanillaEntity } from '../entities/DetallePlanillaEntity';
import { ObreroEntity } from '../entities/ObreroEntity';
import { AdelantoEntity } from '../entities/AdelantoEntity';
import { AsistenciaDiariaEntity } from '../entities/AsistenciaDiariaEntity';
import { InjectModel, Model, SheetsRepository, SheetsRepositoryFactory } from '@sheetOdm/index';
import { SheetDocumentHydrator } from '@sheetOdm/core/base/SheetDocumentHydrator';
import { ProjectionService } from '@sheetOdm/engines/projection.service';


@Injectable()
export class PlanillaTareoService {
    private readonly logger = new Logger(PlanillaTareoService.name);

    constructor(
        @InjectModel(DetallePlanillaEntity)
        private readonly detallePlanillaModel: Model<DetallePlanillaEntity>,
        private readonly projectionService: ProjectionService
    ) { }

    /**
     * 1. Crear Categoría Tarifaria (Maestro)
     */
    /* async crearCategoria(dto: CategoriaEntity) {
         if (!dto.id) {
             throw new Error("El ID de la categoría es obligatorio para la operación.");
         }
         const doc = await this.repo.create1(dto);
         return { message: 'Categoría creada correctamente en Sheets' };
     }*/

    /*async createObreroConAdelantos(data: any): Promise<ObreroEntity> {
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
    }*/

    /**
     * Persiste o actualiza un registro en Google Sheets
     */
    async save(dto: CreateDetallePlanillaDto): Promise<DetallePlanillaEntity> {
        // La magia: el modelo se encarga de transformar el DTO en entidad 
        // y gestionar la persistencia en la hoja correspondiente.
        return await new this.detallePlanillaModel(dto).save();
    }

    async findOne(id: string, projection?: any) {
        const items = await this.detallePlanillaModel.find({ idObrero: id });

        // El resultado de 'find' siempre es un array. Tomamos el primero si existe.
        const item = items && items.length > 0 ? items[0] : null;

        if (!item) {
            throw new NotFoundException(`DetallePlanilla con ID ${id} no encontrado`);
        }

        // Ahora el ProjectionService aceptará el objeto 'item' sin quejarse
        return this.projectionService.project(item, DetallePlanillaEntity, projection);
    }



}