import { Injectable } from "@nestjs/common";
import { MetadataRegistry } from "./metadata-registry.service";
import { SheetDataTransformer } from "@sheetOdm/core/base/sheetDataTransformer";
import { ROW_INDEX_SYMBOL } from "@sheetOdm/constants/metadata.constants";
import { ClassType } from "@sheetOdm/types/query.types";

@Injectable()
export class DataMapper {
    constructor(
        private readonly registry: MetadataRegistry,
        private readonly transformer: SheetDataTransformer
    ) { }

    /**
     * Convierte una fila cruda (array) de Sheets en un objeto plano mapeado con la Entidad
     */
    toPlainObject<T extends object>(row: any[], entityClass: ClassType<T>, headers: string[], rowIndex: number): any {
        const plainObject: any = {};
        plainObject[ROW_INDEX_SYMBOL] = rowIndex;

        const details = this.registry.getColumnDetails(entityClass);

        Object.keys(details).forEach(prop => {
            const colConfig = details[prop];
            const headerName = colConfig.name ? colConfig.name.toUpperCase() : prop.toUpperCase();
            const colIndex = headers.indexOf(headerName);

            if (colIndex !== -1 && row[colIndex] !== undefined) {
                plainObject[prop] = this.transformer.castValue(row[colIndex], colConfig.type);
            } else {
                plainObject[prop] = colConfig.default ?? null;
            }
        });

        return plainObject;
    }

    /**
     * Convierte un objeto plano o documento en un Array ordenado según las cabeceras de la hoja
     */
    toFlatRow<T extends object>(data: any, entityClass: ClassType<T>, headers: string[]): any[] {
        const details = this.registry.getColumnDetails(entityClass);
        const targetData = typeof data.toObject === 'function' ? data.toObject() : data;

        return headers.map(header => {
            const normalizedHeader = header.trim().toUpperCase();

            const propName = Object.keys(details).find(p => {
                const colConfig = details[p];
                const hName = colConfig.name ? colConfig.name.trim().toUpperCase() : p.trim().toUpperCase();
                return hName === normalizedHeader;
            });

            if (!propName) return '';

            return this.transformer.prepareValueForSheet(targetData[propName], details[propName].type);
        });
    }

    /**
     * Convierte una fila cruda (array) en una instancia de la Entidad
     */
    toEntity<T extends object>(row: any[], entityClass: ClassType<T>): T {
        const entity = new entityClass() as any;
        const colMap = this.registry.getColumnMap(entityClass);
        const colDetails = this.registry.getColumnDetails(entityClass);

        Object.entries(colMap).forEach(([propName, index]) => {
            const rawValue = row[index];
            const columnOptions = colDetails[propName];

            // 🎯 Unificación de la tubería de parseo usando el transformer central
            entity[propName] = this.transformer.castValue(rawValue, columnOptions?.type);
        });

        return entity;
    }

}