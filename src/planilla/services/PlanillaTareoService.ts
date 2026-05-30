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





}