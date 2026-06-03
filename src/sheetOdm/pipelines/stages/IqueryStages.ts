export interface IQueryStage {
    execute(data: any[], config: any): Promise<any[]> | any[];
    validate(config: any): void;
}
