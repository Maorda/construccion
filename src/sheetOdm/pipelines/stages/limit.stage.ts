import { Injectable } from "@nestjs/common";
import { IQueryStage } from "./IqueryStages";

@Injectable()
export class LimitStage implements IQueryStage {
    public async execute(data: any[], config: number): Promise<any[]> {
        const limitAmount = Number(config);

        // Si el límite es 0 (o inválido), devolvemos un array vacío (comportamiento Mongoose)
        if (isNaN(limitAmount) || limitAmount <= 0) return [];

        // slice(0, N) retorna los primeros N elementos
        return data.slice(0, limitAmount);
    }

    public validate(config: any): void {
        if (typeof config !== 'number' || config <= 0) {
            throw new Error('[LimitStage] El valor de $limit debe ser un número entero mayor a cero.');
        }
    }
}