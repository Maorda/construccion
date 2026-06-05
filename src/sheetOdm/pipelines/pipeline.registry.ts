import { Injectable, Inject, Logger } from "@nestjs/common";
import { PIPELINE_STAGE } from './pipeline.constants';
import { IQueryStage } from "./stages/IqueryStages";

@Injectable()
export class PipelineOrchestrator {
    private readonly logger = new Logger(PipelineOrchestrator.name);
    private readonly stagesMap: Map<string, IQueryStage> = new Map();

    constructor(@Inject(PIPELINE_STAGE) private readonly stages: IQueryStage[]) {
        // Mapeo automático basado en el nombre de la clase
        this.stages.forEach(stage => {
            const operator = `$${stage.constructor.name.replace('Stage', '').toLowerCase()}`;
            this.stagesMap.set(operator, stage);
        });
    }

    public async executePipeline(data: any[], pipeline: Record<string, any>[]): Promise<any[]> {
        let result = data;

        for (const stageConfig of pipeline) {
            const operator = Object.keys(stageConfig)[0];
            const config = stageConfig[operator];
            const stage = this.stagesMap.get(operator);

            if (!stage) {
                this.logger.warn(`Stage no soportado: ${operator}`);
                continue;
            }

            try {
                stage.validate(config);
                result = await stage.execute(result, config);
            } catch (error) {
                this.logger.error(`Error en el stage ${operator}: ${error.message}`);
                throw error;
            }
        }
        return result;
    }
}