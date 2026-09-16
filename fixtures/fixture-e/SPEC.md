# SPEC — ranking

- `rankVideos(videos)` returns videos ordered by **score, highest first** (descending).
- Tie-break: when two videos share a score, the one with the **earlier `createdAt` comes first**.
- The input array must not be mutated.
