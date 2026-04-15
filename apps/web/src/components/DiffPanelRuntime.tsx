import type { DiffPanelMode } from "./DiffPanelShell";
import DiffPanel from "./DiffPanel";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanelRuntime(props: { mode: DiffPanelMode }) {
  return (
    // Keep worker-pool setup colocated with the diff panel so route-level lazy loading
    // can defer all diff runtime costs until a user actually opens the panel.
    <DiffWorkerPoolProvider>
      <DiffPanel mode={props.mode} />
    </DiffWorkerPoolProvider>
  );
}
