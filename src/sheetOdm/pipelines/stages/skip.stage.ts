import { Injectable } from "@nestjs/common";
import { IQueryStage } from "./IqueryStages";

@Injectable()
export class SkipStage implements IQueryStage {
    public async execute(data: any[], config: number): Promise<any[]> {
        const skipAmount = Number(config);

        // Si el skip es 0 o negativo, devolvemos los datos tal cual
        if (isNaN(skipAmount) || skipAmount <= 0) return data;

        // slice(N) retorna el array cortado desde el índice N hasta el final
        return data.slice(skipAmount);
    }

    public validate(config: any): void {
        if (typeof config !== 'number' || config < 0) {
            throw new Error('[SkipStage] El valor de $skip debe ser un número entero positivo o cero.');
        }
    }
}