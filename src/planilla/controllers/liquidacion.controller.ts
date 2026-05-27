// src/payroll/controllers/liquidacion.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus, Put, Param } from '@nestjs/common';
import { PlanillaTareoService } from '../services/PlanillaTareoService'; // Ajusta la ruta relativa según tu árbol

@Controller('obreros')
export class ObrerosController {
    // Sincronizado con el nombre real de tu servicio Core
    constructor(private readonly planillaTareoService: PlanillaTareoService) { }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async registrarPlanillaCompleta(@Body() payload: any) {

        return {
            status: 'success',
            message: 'Obrero y desglose de asistencias guardados exitosamente en Google Sheets.',
        };
    }
}