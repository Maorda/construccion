import { Injectable } from "@nestjs/common";
import { MetadataRegistry } from "./metadata-registry.service";

@Injectable()
export class DataMapper {
    constructor(private readonly registry: MetadataRegistry) { }

    /**
     * Convierte una fila cruda (array) en una instancia de la Entidad
     */
    toEntity<T extends object>(row: any[], entityClass: new () => T): T {
        const entity = new entityClass();
        const colMap = this.registry.getColumnMap(entityClass);
        const colDetails = this.registry.getColumnDetails(entityClass);

        Object.entries(colMap).forEach(([propName, index]) => {
            const rawValue = row[index];
            const columnOptions = colDetails[propName];

            // Aquí podrías añadir lógica de casting (ej: convertir a número si type === 'number')
            entity[propName] = this.castValue(rawValue, columnOptions?.type);
        });

        return entity;
    }

    private castValue(value: any, type?: string) {
        if (value === undefined || value === '') return null;
        if (type === 'number') return Number(value);
        if (type === 'boolean') return value === 'true';
        return value;
    }
}