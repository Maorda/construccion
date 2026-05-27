import { Body, Controller, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { PlanillaTareoService } from "../services/PlanillaTareoService";
import { CategoriaEntity, CreateCategoriaDto } from "../entities/CategoriaEntity";
import { Logger } from "@nestjs/common";
import { CreateDetallePlanillaDto } from "../entities/DetallePlanillaEntity";

@Controller('admin-planilla')
export class PlanillaAdminController {
    private readonly logger = new Logger(PlanillaAdminController.name);
    constructor(
        private readonly planillaService: PlanillaTareoService,

    ) { }

    @Post('categorias')
    @HttpCode(HttpStatus.CREATED)
    async crearCategoria(@Body() dto: CreateCategoriaDto) {
        this.logger.log(`Recibiendo petición para guardar categoría: ${dto.id}`);
        try {
            return await this.planillaService.crearCategoria(dto);
        } catch (error) {
            this.logger.error(`Error al guardar: ${error.message}`);
            throw error;
        }
    }
    @Post('obrero')
    @HttpCode(HttpStatus.CREATED)
    async createObrero(@Body() body: any) {
        this.logger.log(`Recibiendo petición para guardar obrero: ${body.id}`);
        try {
            return await this.planillaService.createObreroConAdelantos(body);
        } catch (error) {
            this.logger.error(`Error al guardar: ${error.message}`);
            throw error;
        }
    }
    @Post('detalle')
    @HttpCode(HttpStatus.CREATED)
    async createDetalle(@Body() dto: CreateDetallePlanillaDto) {
        // console.log('DTO recibido:', dto);
        this.logger.log(`Recibiendo petición para guardar detalle: ${JSON.stringify(dto)}`);
        try {
            const result = await this.planillaService.createDetalle(dto);
            console.log('✅ Resultado del guardado en Sheets:', result); // <--- AGREGAR
            return result;
        } catch (error) {
            this.logger.error(`Error al guardar: ${error.message}`);
            throw error;
        }
    }

}