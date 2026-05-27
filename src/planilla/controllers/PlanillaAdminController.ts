import { Body, Controller, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { PlanillaTareoService } from "../services/PlanillaTareoService";
import { CategoriaEntity, CreateCategoriaDto } from "../entities/CategoriaEntity";
import { Logger } from "@nestjs/common";

@Controller('admin-planilla')
export class PlanillaAdminController {
    private readonly logger = new Logger(PlanillaAdminController.name);
    constructor(private readonly planillaService: PlanillaTareoService) { }

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

}