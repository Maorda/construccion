export interface IQueryStage {
    execute(data: any[], config: any): Promise<any[]> | any[];
}
