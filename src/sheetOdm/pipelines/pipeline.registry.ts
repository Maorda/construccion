import { Injectable, Logger } from "@nestjs/common";
import { IQueryStage } from "./stages/IqueryStages";
import { GroupStage, LookupStage, UnwindStage } from "./stages/Estructura_Compleja";
import { AddFieldsStage, MatchStage, ProjectStage } from "./stages/filtrado_y_transformacion";
import { LimitStage, SkipStage, SortStage } from "./stages/orden_y_paginacion";



@Injectable()
export class PipelineOrchestrator {
    private readonly logger = new Logger(PipelineOrchestrator.name);
    private readonly stages: Record<string, IQueryStage>;

    constructor(
        private readonly match: MatchStage,
        private readonly sort: SortStage,
        private readonly addFields: AddFieldsStage,
        private readonly group: GroupStage,
        private readonly limit: LimitStage,
        private readonly lookup: LookupStage,
        private readonly project: ProjectStage,
        private readonly skip: SkipStage,
        private readonly unwind: UnwindStage
    ) {
        // Registro completo de los plugins disponibles
        this.stages = {
            '$match': this.match,
            '$sort': this.sort,
            '$addFields': this.addFields,
            '$group': this.group,
            '$limit': this.limit,
            '$lookup': this.lookup,
            '$project': this.project,
            '$skip': this.skip,
            '$unwind': this.unwind
        };
    }

    /**
     * Ejecuta una serie de stages sobre un conjunto de datos
     * pipeline: Array de objetos [{ $match: {...} }, { $sort: {...} }]
     */
    public async executePipeline(data: any[], pipeline: Record<string, any>[]): Promise<any[]> {
        let result = data;

        for (const stageConfig of pipeline) {
            const operator = Object.keys(stageConfig)[0];
            const config = stageConfig[operator];
            const stage = this.stages[operator];

            if (!stage) {
                this.logger.warn(`Stage no soportado: ${operator}`);
                continue; // O podrías lanzar un error: throw new Error(...)
            }

            try {
                // 1. Validar el plugin
                stage.validate(config);

                // 2. Ejecutar el plugin
                // Usamos await por si algún stage decide ser asíncrono en el futuro
                result = await stage.execute(result, config);

            } catch (error) {
                this.logger.error(`Error en el stage ${operator}: ${error.message}`);
                throw error; // Detenemos la ejecución si falla una etapa crítica
            }
        }

        return result;
    }
}