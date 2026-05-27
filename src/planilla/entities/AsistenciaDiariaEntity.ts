import { Column } from "@sheetOdm/decorators/column.decorator";
import { PrimaryKey } from "@sheetOdm/decorators/primarykey.decorator";
import { Table } from "@sheetOdm/decorators/table.decorator";
import { IsString, IsNotEmpty } from "class-validator";


export class CreateAsistenciaDiariaDto {
    @IsString()
    @IsNotEmpty()
    id: string;

    @IsString()
    @IsNotEmpty()
    idObrero: string;

    @IsString()
    @IsNotEmpty()
    fecha: string;

    @IsString()
    ingresoManana: string;

    @IsString()
    salidaManana: string;

    @IsString()
    ingresoTarde: string;

    @IsString()
    salidaTarde: string;

    @IsString()
    estado: string;
}

@Table('ASISTENCIAS_DIARIAS', { dto: CreateAsistenciaDiariaDto })
export class AsistenciaDiariaEntity {
    @PrimaryKey()
    @Column({ name: 'ID_ASISTENCIA', generated: 'uuid' })
    id: string;

    @Column({ name: 'ID_OBRERO', required: true })
    idObrero: string;

    @Column({ name: 'FECHA', type: 'date', required: true })
    fecha: string; // YYYY-MM-DD

    @Column({ name: 'INGRESO_MANANA', default: '' })
    ingresoManana: string; // Ej: "06:00" o "07:00"

    @Column({ name: 'SALIDA_MANANA', default: '' })
    salidaManana: string; // Ej: "13:00"

    @Column({ name: 'INGRESO_TARDE', default: '' })
    ingresoTarde: string; // Ej: "14:00"

    @Column({ name: 'SALIDA_TARDE', default: '' })
    salidaTarde: string; // Ej: "17:30"

    @Column({ name: 'ESTADO', default: 'ASISTIO' })
    estado: 'ASISTIO' | 'FALTA_JUSTIFICADA' | 'FALTA_INJUSTIFICADA' | 'PERMISO_JUSTIFICADO' | 'PERMISO_INJUSTIFICADO';
}
