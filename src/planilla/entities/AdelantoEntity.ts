
import { PrimaryKey } from "@sheetOdm/decorators/primarykey.decorator";
import { Column } from "@sheetOdm/decorators/column.decorator";
import { Table } from "@sheetOdm/decorators/table.decorator";
import { IsString, IsNotEmpty, IsDate, IsNumber } from "class-validator";




export class CreateAdelantoDto {
    @IsString()
    @IsNotEmpty()
    id: string;

    @IsString()
    @IsNotEmpty()
    idPlanilla: string;

    @IsString()
    @IsNotEmpty()
    idObrero: string;

    @IsString()
    @IsNotEmpty()
    fecha: string;

    @IsNumber()
    @IsNotEmpty()
    monto: number;

    @IsString()
    @IsNotEmpty()
    motivo: string;
}

@Table('ADELANTOS_DIARIOS', { dto: CreateAdelantoDto })
export class AdelantoEntity {
    @PrimaryKey()
    @Column({ name: 'ID_ADELANTO', generated: 'uuid' })
    id: string;

    @Column({ name: 'ID_PLANILLA', required: true })
    idPlanilla: string;

    @Column({ name: 'ID_OBRERO', required: true })
    idObrero: string;

    @Column({ name: 'FECHA', type: 'date', required: true })
    fecha: string;

    @Column({ name: 'MONTO', type: 'number', required: true })
    monto: number;

    @Column({ name: 'MOTIVO', type: 'string', default: 'Adelanto regular' })
    motivo: string;
}
