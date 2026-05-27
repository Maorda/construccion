import { Module } from '@nestjs/common';
import { CategoriaEntity } from './entities/CategoriaEntity';
import { DetallePlanillaEntity } from './entities/DetallePlanillaEntity';
import { ObreroEntity } from './entities/ObreroEntity';
import { PlanillaAdminController } from './controllers/PlanillaAdminController';
import { TareoRelojController } from './controllers/TareoRelojController';
import { PlanillaTareoService } from './services/PlanillaTareoService';
import { AsistenciaDiariaEntity } from './entities/AsistenciaDiariaEntity';
import { AdelantoEntity } from './entities/AdelantoEntity';
import { OdmSheetModule } from '@sheetOdm/odm-sheet.module';
import { ObrerosController } from './controllers/liquidacion.controller';

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
