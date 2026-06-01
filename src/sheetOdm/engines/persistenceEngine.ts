import { Logger, InternalServerErrorException, ConflictException, BadRequestException } from '@nestjs/common';

export class PersistenceEngine {
    private readonly logger = new Logger(PersistenceEngine.name);
    constructor(
        private readonly metadataRegistry: MetadataRegistry,
        private readonly transformer: SheetDataTransformer,
        private readonly gettersEngine: GettersEngine,
        private readonly aggregationEngine: AggregationEngine,
        private readonly moduleRef: ModuleRef

    ) { }


    public async saveWithRelations<E extends object>(entityClass: ClassType<E>, gateway: SheetsDataGateway, payload: any): Promise<E> {
        if (!payload || typeof payload !== 'object') {
            throw new ConflictException('El payload de la entidad compuesta no es válido.');
        }

        const plainParentData = { ...payload };
        const relationsData: Record<string, { options: RelationOptions; data: any }> = {};
        const primaryKeyProp = this.metadataRegistry.getPrimaryKeyField(entityClass);

        // Aislar propiedades declaradas con decoradores relacionales desde el Registry real
        const registeredRelations = this.metadataRegistry.getRelationsList(entityClass);
        for (const key of Object.keys(payload)) {
            if (registeredRelations.includes(key)) {
                const relationOptions = this.metadataRegistry.getRelationOptions(entityClass, key);
                relationsData[key] = { options: relationOptions, data: payload[key] };
                delete plainParentData[key];
            }
        }

        if (plainParentData[primaryKeyProp] === undefined || plainParentData[primaryKeyProp] === null || String(plainParentData[primaryKeyProp]).trim() === '') {
            plainParentData[primaryKeyProp] = IdGenerator.generate();
        }

        const parentInstance = new entityClass();
        Object.assign(parentInstance, plainParentData);

        const savedParentResult = await this.save(entityClass, gateway, parentInstance);
        const finalParentId = (savedParentResult as any)[primaryKeyProp];

        for (const [propertyKey, relationContainer] of Object.entries(relationsData)) {
            const { options, data: childrenData } = relationContainer;
            if (!childrenData) continue;

            const TargetEntityClass = options.targetEntity();
            const exactFeatureToken = `${TargetEntityClass.name}Repository`;

            let resolvedTokenInstance: any = null;
            try { resolvedTokenInstance = this.moduleRef.get(exactFeatureToken, { strict: false }); } catch (e) { }

            if (!resolvedTokenInstance) {
                throw new InternalServerErrorException(`El motor de cascada no pudo localizar el repositorio para la entidad "${TargetEntityClass.name}".`);
            }

            const joinColumnField = options.joinColumn;
            const isMany = Array.isArray(childrenData);
            const recordsToSave = isMany ? childrenData : [childrenData];
            const savedChildrenResults: any[] = [];
            const childPrimaryKeyProp = this.metadataRegistry.getPrimaryKeyField(TargetEntityClass);

            for (const childPayload of recordsToSave) {
                if (!childPayload || typeof childPayload !== 'object') continue;

                if (childPayload[childPrimaryKeyProp] === undefined || childPayload[childPrimaryKeyProp] === null || String(childPayload[childPrimaryKeyProp]).trim() === '') {
                    childPayload[childPrimaryKeyProp] = IdGenerator.generate();
                }

                childPayload[joinColumnField] = finalParentId;

                const childInstance = new TargetEntityClass();
                Object.assign(childInstance, childPayload);

                let processedChild: any;
                let targetPersistenceEngine: any = null;

                if (resolvedTokenInstance.ctx?.persistenceEngine) {
                    targetPersistenceEngine = resolvedTokenInstance.ctx.persistenceEngine;
                } else if (resolvedTokenInstance.persistenceEngine) {
                    targetPersistenceEngine = resolvedTokenInstance.persistenceEngine;
                }

                if (targetPersistenceEngine && typeof targetPersistenceEngine.save === 'function') {
                    processedChild = await targetPersistenceEngine.save(TargetEntityClass, gateway, childInstance);
                } else if (typeof resolvedTokenInstance.save === 'function') {
                    processedChild = await resolvedTokenInstance.save(childInstance);
                }

                savedChildrenResults.push(processedChild);
            }

            (savedParentResult as any)[propertyKey] = isMany ? savedChildrenResults : savedChildrenResults[0];
        }

        return savedParentResult;
    }


    public async findOneAndUpdate<T extends object>(
        entityClass: ClassType<T>,
        gateway: SheetsDataGateway,
        filter: FilterQuery<T>,
        updateData: UpdateQuery<T> | any[],
        options: { projection?: any, upsert?: boolean, new?: boolean } = { new: true, upsert: false }
    ): Promise<Partial<T> | null> {

        // 🟢 CORRECCIÓN: Inyectamos el array de entidades al motor puro
        const entities = await gateway.getEntitiesWithResilience(entityClass);
        let entity: T | null = await this.gettersEngine.findOneInternal(entityClass, entities, filter);

        const oldState = entity ? JSON.parse(JSON.stringify(entity)) : null;

        if (!entity) {
            if (options.upsert) {
                const newInstance = new (entityClass as any)();
                Object.assign(newInstance, this.extractLiteralFields(filter));
                entity = newInstance as T;
            } else {
                return null;
            }
        }

        let finalPayload: T;

        // 2. Resolver mutaciones
        if (Array.isArray(updateData)) {
            const result = await this.aggregationEngine.run([entity], updateData);
            finalPayload = result[0] as T;
        } else {
            const update = updateData as UpdateQuery<T>;
            if (update.$push) {
                await this.processRelationalPushes(entityClass, gateway, entity, update.$push);
            }
            finalPayload = this.applyUpdateQuery(entity, update);
        }

        // 3. Persistencia usando estrictamente tu MetadataRegistry y los métodos reales del Gateway
        const pkField = this.metadataRegistry.getPrimaryKeyField(entityClass);
        const idValue = (finalPayload as any)[pkField];

        const physicalRow = (entity as any).__row;

        if (physicalRow && idValue) {
            await gateway.updateEntity(entityClass, idValue, finalPayload);
        } else {
            const created = await this.save(entityClass, gateway, finalPayload);
            (entity as any).__row = (created as any).__row;
            (finalPayload as any).__row = (created as any).__row;
        }

        const resultState = options.new ? finalPayload : (oldState || finalPayload);

        // 🟢 CORRECCIÓN: Usamos tu método real síncrono de proyección
        return options.projection
            ? this.gettersEngine.applyProjection(resultState as T, options.projection)
            : resultState as Partial<T>;
    }


    public async deleteOne<T extends object>(
        entityClass: ClassType<T>,
        gateway: SheetsDataGateway,
        filter: FilterQuery<T>
    ): Promise<boolean> {
        // 🟢 CORRECCIÓN: 1. Obtenemos las entidades. 2. Las pasamos al GettersEngine.
        const entities = await gateway.getEntitiesWithResilience(entityClass);
        const currentRecord = await this.gettersEngine.findOneInternal(entityClass, entities, filter);

        if (!currentRecord) return false;

        const pkField = this.metadataRegistry.getPrimaryKeyField(entityClass);
        const parentId = currentRecord[pkField as keyof T];

        // Evalúa restricciones relacionales profundas de forma aislada
        await this.resolveReferentialIntegrity(entityClass, gateway, parentId);

        // Ejecuta la eliminación física delegando al método estructurado real
        await this.delete(entityClass, gateway, parentId as string | number);
        return true;
    }

    public async save<T extends object>(
        entityClass: ClassType<T>,
        gateway: SheetsDataGateway,
        entity: T
    ): Promise<T> {
        if (!entityClass || !gateway || !entity) {
            throw new InternalServerErrorException('Faltan parámetros requeridos en save().');
        }

        // 1. Aplicar campos autogenerados (UUID, ShortID, AutoIncrement) en memoria
        await this.applyAutogeneratedFields(entityClass, gateway, entity);

        // 2. Sanear el control de borrado lógico
        this.sanitizeDeleteControl(entityClass, entity);

        // 3. Delegar persistencia al método operativo real del gateway
        return await gateway.saveEntity(entityClass, entity);
    }

    public async updateEntity<T extends object>(
        entityClass: ClassType<T>,
        gateway: SheetsDataGateway,
        entity: T,
        changes: Partial<T>
    ): Promise<void> {
        const rowIndex = (entity as any).__row;
        if (rowIndex === undefined || rowIndex === null || rowIndex === -1) {
            throw new BadRequestException("No se puede actualizar una entidad que carece de un índice físico válido (__row).");
        }

        this.logger.debug(`[UpdateEntity] Despachando actualización parcial en la fila física: ${rowIndex}`);
        await gateway.updatePartialRow(entityClass, rowIndex, changes);
        Object.assign(entity, changes);
    }

    /**
     * 🟢 REFACTORIZADO: Aplica modificaciones mutacionales estructuradas ($set, $inc) localizando por ID.
     */
    public async update<T extends object>(
        entityClass: ClassType<T>,
        gateway: SheetsDataGateway,
        id: string | number,
        entity: T
    ): Promise<T> {
        // Delegación pura: El gateway (y su EntityBinder) se encarga de la serialización a celdas.
        return await gateway.updateEntity(entityClass, id, entity as Partial<T>);
    }

    public async delete<T extends object>(
        entityClass: ClassType<T>,
        gateway: SheetsDataGateway,
        id: string | number
    ): Promise<void> {
        await gateway.deleteEntity(entityClass, id);
    }

    /**
     * 🟢 MANTENIDO: Permite la actualización masiva de celdas directas por coordenadas de rango.
     */
    public async updateCellsBatch(gateway: SheetsDataGateway, updates: { range: string, value: any, type?: string }[]): Promise<void> {
        if (!updates || updates.length === 0) return;
        const data = updates.map(u => ({
            range: u.range,
            values: [[this.transformer.prepareValueForSheet(u.value, u.type)]]
        }));
        await withRetry(async () => await gateway.updateCellsBatch(data), 3, 1500);
    }
    private indexToColumnLetter(index: number): string {
        if (index < 0) return '';
        let temp = index;
        let letter = '';
        while (temp >= 0) {
            letter = String.fromCharCode((temp % 26) + 65) + letter;
            temp = Math.floor(temp / 26) - 1;
        }
        return letter;
    }




    public async exists<T extends object>(
        entityClass: ClassType<T>,
        gateway: SheetsDataGateway,
        id: string | number
    ): Promise<boolean> {
        return await gateway.exists(entityClass, id);
    }

    private async applyAutogeneratedFields<T extends object>(
        entityClass: ClassType<T>,
        gateway: SheetsDataGateway,
        entity: any
    ): Promise<void> {
        if (!entity) return;

        // 🟢 Consumimos los metadatos desde tu especialista
        const currentColumnDetails = this.metadataRegistry.getColumnDetails(entityClass) || {};

        for (const key of Object.keys(currentColumnDetails)) {
            const config = currentColumnDetails[key];
            if (!config || (!config.generated && !config.isAutoIncrement)) continue;

            if (entity[key] === undefined || entity[key] === null || entity[key] === '') {
                let generatedValue: string | number;

                if (config.generated === 'uuid') {
                    generatedValue = IdGenerator.generate();
                } else if (config.generated === 'short-id') {
                    generatedValue = IdGenerator.generateShort();
                } else if (config.isAutoIncrement || config.generated === 'increment') {
                    try {
                        // 🟢 CORRECCIÓN: Usamos el gateway real para obtener las entidades
                        const activeEntities = await gateway.getEntitiesWithResilience(entityClass);
                        let maxId = 0;

                        activeEntities.forEach((item: any) => {
                            const val = parseInt(item[key], 10);
                            if (!isNaN(val) && val > maxId) maxId = val;
                        });

                        generatedValue = maxId + 1;
                    } catch (e: any) {
                        this.logger.warn(`[AutoIncrement] Fallback a id = 1 en '${key}'. Motivo: ${e.message}`);
                        generatedValue = 1;
                    }
                } else {
                    generatedValue = IdGenerator.generate();
                }

                entity[key] = generatedValue;
            }
        }
    }

    private async processRelationalPushes<T extends object>(entityClass: ClassType<T>, gateway: SheetsDataGateway, entity: T, $push: Record<string, any>): Promise<void> {
        const pkProp = this.metadataRegistry.getPrimaryKeyField(entityClass);
        const parentId = (entity as any)[pkProp];

        for (const propertyKey in $push) {
            const relationMeta = this.metadataRegistry.getRelationOptions(entityClass, propertyKey);
            if (relationMeta && relationMeta.isMany) {
                const childRepo = this.moduleRef.get(relationMeta.targetRepository, { strict: false });
                if (!childRepo) continue;

                const children = Array.isArray($push[propertyKey]) ? $push[propertyKey] : [$push[propertyKey]];
                await Promise.all(children.map(async (childData) => {
                    childData[relationMeta.joinColumn] = parentId;
                    return await childRepo.save(childData);
                }));
                delete $push[propertyKey];
            }
        }
    }

    public sanitizeDeleteControl<T extends object>(entityClass: ClassType<T>, entity: any): void {
        const deleteControlProp = this.metadataRegistry.getDeleteControlProperty(entityClass);
        if (deleteControlProp) {
            const currentValue = entity[deleteControlProp];
            if (currentValue === undefined || currentValue === null) {
                entity[deleteControlProp] = false;
            }
        }
    }

    private async resolveReferentialIntegrity<T extends object>(parentEntityClass: ClassType<T>, gateway: SheetsDataGateway, parentId: any): Promise<void> {
        const parentEntityName = parentEntityClass.name;
        const dependencies = GLOBAL_RELATION_REGISTRY.get(parentEntityName) || [];
        if (dependencies.length === 0) return;

        for (const dep of dependencies) {
            let repositoryToken = dep.childRepository;

            if (!repositoryToken) {
                const camelCase = dep.childSheet.toLowerCase().replace(/_([a-z])/g, (_, g) => g.toUpperCase());
                const pascalCase = camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
                repositoryToken = `${pascalCase}Repository`;
            }

            let childRepository: any;
            try {
                childRepository = this.moduleRef.get(repositoryToken, { strict: false });
            } catch (error) {
                throw new InternalServerErrorException(`El repositorio requerido '${String(repositoryToken)}' por [${parentEntityName}] no está disponible.`);
            }

            const strategy = dep.onDelete || 'RESTRICT';
            let childRecords: any[] = [];
            if (typeof childRepository.find === 'function') {
                childRecords = await childRepository.find({ [dep.joinColumn]: parentId }) || [];
            }

            const dependentCount = childRecords.length;

            switch (strategy) {
                case 'RESTRICT':
                    if (dependentCount > 0) {
                        throw new BadRequestException(
                            `Restricción de Integridad: No se puede eliminar el registro en [${parentEntityName.toUpperCase()}] porque tiene ${dependentCount} registros vinculados en la hoja [${dep.childSheet}].`
                        );
                    }
                    break;

                case 'SET_NULL':
                    if (dependentCount === 0) break;
                    for (const childRecord of childRecords) {
                        const childTargetClass = childRecord.constructor;
                        const childPkField = this.metadataRegistry.getPrimaryKeyField(childTargetClass);
                        const childId = childRecord[childPkField];

                        const filter = { [childPkField]: childId };
                        const updatePayload = { $set: { [dep.joinColumn]: null } };

                        if (typeof childRepository.updateOne === 'function') {
                            await childRepository.updateOne(filter, updatePayload);
                        }
                    }
                    break;

                case 'CASCADE':
                    if (dependentCount === 0) break;
                    for (const childRecord of childRecords) {
                        const childTargetClass = childRecord.constructor;
                        const childPkField = this.metadataRegistry.getPrimaryKeyField(childTargetClass);
                        const childId = childRecord[childPkField];

                        if (typeof childRepository.deleteOne === 'function') {
                            await childRepository.deleteOne({ [childPkField]: childId });
                        }
                    }
                    break;

                default:
                    throw new InternalServerErrorException(`La estrategia onDelete: '${strategy}' no está soportada.`);
            }
        }
    }

    private applyUpdateQuery<T extends object>(current: T, query: UpdateQuery<T>): T {
        let updated = { ...current } as any;
        const { $set, $inc, $push, ...plainData } = query as any;
        Object.assign(updated, plainData);
        if ($set) Object.assign(updated, $set);
        if ($inc) {
            for (const key in $inc) {
                if (typeof $inc[key] === 'number') updated[key] = (Number(updated[key]) || 0) + $inc[key];
            }
        }
        if ($push) {
            for (const key in $push) {
                let arr = Array.isArray(updated[key]) ? updated[key] : [];
                arr.push($push[key]);
                updated[key] = arr;
            }
        }
        return updated as T;
    }

    private extractLiteralFields(filter: FilterQuery<any>): Record<string, any> {
        const literals: Record<string, any> = {};
        if (!filter || typeof filter !== 'object') return literals;
        for (const [key, value] of Object.entries(filter)) {
            if (value === null || typeof value !== 'object' || value instanceof Date || value instanceof RegExp) {
                literals[key] = value;
            }
        }
        return literals;
    }
}

