import { Module } from '@nestjs/common';
import { CategoriaEntity } from './entities/CategoriaEntity.js';
import { DetallePlanillaEntity } from './entities/DetallePlanillaEntity.js';
import { ObreroEntity } from './entities/ObreroEntity.js';
import { PlanillaAdminController } from './controllers/PlanillaAdminController.js';
import { TareoRelojController } from './controllers/TareoRelojController.js';
import { PlanillaTareoService } from './services/PlanillaTareoService.js';
import { AsistenciaDiariaEntity } from './entities/AsistenciaDiariaEntity.js';
import { AdelantoEntity } from './entities/AdelantoEntity.js';
import { OdmSheetModule } from '@sheetOdm/odm-sheet.module.js';
import { ObrerosController } from './controllers/liquidacion.controller.js';

@Module({
  imports: [
    // ¡Igual que MongooseModule.forFeature!
    OdmSheetModule.forFeature([
      ObreroEntity,
      AsistenciaDiariaEntity,
      DetallePlanillaEntity,
      CategoriaEntity,
      AdelantoEntity]),

  ],
  controllers: [PlanillaAdminController, TareoRelojController, ObrerosController],
  providers: [PlanillaTareoService],
  exports: [PlanillaTareoService],
})
export class PlanillaModule { }
