import { ILocation } from "./ILocation";

export interface ISymbolInformation {
  name: string;
  kind: number;
  location: ILocation;
  containerName?: string;
}
