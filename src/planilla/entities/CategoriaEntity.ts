import { Column } from "@sheetOdm/decorators/column.decorator";
import { PrimaryKey } from "@sheetOdm/decorators/primarykey.decorator";
import { Table } from "@sheetOdm/decorators/table.decorator";
import { IsString, IsNotEmpty, IsNumber } from "class-validator";


export class CreateCategoriaDto {
    @IsString()
    @IsNotEmpty()
    id: string;

    @IsString()
    @IsNotEmpty()
    descripcion: string;

    @IsNumber()
    costoHoraNormal: number;

    @IsNumber()
    costoHoraExtra: number;
}

@Table('CATEGORIAS', { dto: CreateCategoriaDto })
export class CategoriaEntity {
    @PrimaryKey()
    @Column({ name: 'ID_CATEGORIA' })
    id: string; // MAESTRO, OPERARIO, OFICIAL, PEON

    @Column({ name: 'DESCRIPCION', required: true })
    descripcion: string;

    @Column({ name: 'COSTO_HORA_NORMAL', type: 'number', required: true })
    costoHoraNormal: number;

    @Column({ name: 'COSTO_HORA_EXTRA', type: 'number', required: true })

    costoHoraExtra: number;
}
