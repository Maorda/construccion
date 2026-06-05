import { Injectable } from "@nestjs/common";

import { GroupConfig, LookupConfig } from "./types";
import { QueryEngine } from "@sheetOdm/engines/query.engine";
import { PipelineStage } from "@sheetOdm/types/query.types";
import { PipelineOrchestrator } from "./pipeline.registry";


@Injectable()
export class AggregationBuilder {
    private pipeline: PipelineStage[] = [];

    constructor(
        private readonly pipelineOrchestrator: PipelineOrchestrator
    ) { }

    match(criteria: Record<string, any>): this {
        this.pipeline.push({ $match: criteria });
        return this;
    }

    lookup(config: LookupConfig): this {
        this.pipeline.push({ $lookup: config });
        return this;
    }

    project(criteria: Record<string, any>): this {
        this.pipeline.push({ $project: criteria });
        return this;
    }

    sort(criteria: Record<string, any>): this {
        this.pipeline.push({ $sort: criteria });
        return this;
    }

    group(criteria: Partial<GroupConfig>): this {
        // Si no enviaron _id, le asignamos null por defecto (o lo que tu motor requiera)
        const fullCriteria: GroupConfig = {
            _id: null,
            ...criteria
        };

        this.pipeline.push({ $group: fullCriteria });
        return this;
    }

    unwind(criteria: string | { path: string }): this {
        this.pipeline.push({ $unwind: criteria });
        return this;
    }

    addFields(criteria: Record<string, any>): this {
        this.pipeline.push({ $addFields: criteria });
        return this;
    }

    limit(criteria: number): this {
        this.pipeline.push({ $limit: criteria });
        return this;
    }

    skip(criteria: number): this {
        this.pipeline.push({ $skip: criteria });
        return this;
    }

    async execute(data: any[]): Promise<any[]> {
        return await this.pipelineOrchestrator.executePipeline(data, this.pipeline as any);
    }
}