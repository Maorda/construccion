import { SheetsRepository } from "@sheetOdm/repository/sheets.repository.js";
import { FilterQuery, PopulateDefinition, PopulateOptions, QueryOptions, RelationKeys } from "@sheetOdm/types/query.types.js";
import { SheetDocument } from "@sheetOdm/wrapper/sheetDocument.js";

export class SheetQuery<T extends object> {
    // Almacenamos internamente un arreglo estandarizado de opciones
    private populateOptions: Array<PopulateOptions<any, any>> = [];

    constructor(
        private repo: SheetsRepository<T>,
        private filter: FilterQuery<T>,
        private options: QueryOptions<T> = {}
    ) { }

    /**
     * Acepta un string, un objeto de opciones, o un arreglo de cualquiera de los dos.
     */
    populate<K extends RelationKeys<T>>(
        pathOrOptions: PopulateDefinition<T> | Array<PopulateDefinition<T>>
    ): this {
        const definitions = Array.isArray(pathOrOptions) ? pathOrOptions : [pathOrOptions];

        for (const def of definitions) {
            if (typeof def === 'string') {
                // Si es un string, lo convertimos al objeto estandarizado
                this.populateOptions.push({ path: def as any });
            } else {
                // Si ya es un objeto, lo agregamos tal cual
                this.populateOptions.push(def as PopulateOptions<T, any>);
            }
        }
        return this;
    }

    async exec(): Promise<SheetDocument<T>[]> {
        const rawDocs = await this.repo.executeBaseFind(this.filter, this.options);

        if (this.populateOptions.length > 0) {
            await this.repo.getRelationManager().populate(
                rawDocs,
                this.repo.entityClass, // 🟢 CORREGIDO: Sin <T> y con cast seguro
                this.populateOptions, // 🟢 CORREGIDO: Cast para aceptar cualquier PopulateOptions
                this.options
            );
        }

        return rawDocs;
    }
}