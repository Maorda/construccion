import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { CategoriaEntity } from '../entities/CategoriaEntity';
import { DetallePlanillaEntity } from '../entities/DetallePlanillaEntity';
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
        private readonly repo: any
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


}