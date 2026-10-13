-- Memory with every worker heartbeat: the container's cgroup usage and
-- limit (it counts api and bot too), and the worker's own RSS with its
-- peak since boot. The all-in-one container runs on a 512 MB free plan and
-- the coin scan now parses ~15 MB of DefiLlama JSON a day; a host that
-- kills a container for memory leaves no trace but a fresh boot time, so
-- the number has to be reported to be seen coming. Null from a worker
-- that predates it.
ALTER TABLE worker_runtime ADD COLUMN IF NOT EXISTS memory JSONB;
