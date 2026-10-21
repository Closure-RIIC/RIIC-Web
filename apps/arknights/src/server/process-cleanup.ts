type ProcessCleanupEvent = "exit";

export type ProcessCleanupTarget = {
  once(event: ProcessCleanupEvent, listener: () => void): unknown;
  removeListener(event: ProcessCleanupEvent, listener: () => void): unknown;
};

export function registerProcessCleanup(
  target: ProcessCleanupTarget,
  stop: (reason: string) => void,
) {
  const onExit = () => stop("进程退出，正在关闭 infra-cli serve。");
  target.once("exit", onExit);

  return () => {
    target.removeListener("exit", onExit);
  };
}
