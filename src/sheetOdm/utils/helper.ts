import { ClassType } from "@sheetOdm/types/query.types";


export const getRepositoryToken = (entity: ClassType) => `${entity.name}Repository`;