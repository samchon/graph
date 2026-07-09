import { SamchonGraphMemory, SamchonGraphApplication } from "@samchon/graph";
import type { ISamchonGraphApplication } from "@samchon/graph";

import { GraphFixtures } from "./GraphFixtures";

const createApplication = (): SamchonGraphApplication =>
  new SamchonGraphApplication(SamchonGraphMemory.from(GraphFixtures.createContractFixture().dump));

const call = (
  app: SamchonGraphApplication,
  request: ISamchonGraphApplication.IProps["request"],
) =>
  app.inspect_code_graph({
    question: `contract ${request.type}`,
    draft: { reason: `${request.type} is under contract test.`, type: request.type },
    review: "Contract fixture intentionally exercises this request branch.",
    request,
  });

export const ContractGraph = {
  call,
  createApplication,
};
