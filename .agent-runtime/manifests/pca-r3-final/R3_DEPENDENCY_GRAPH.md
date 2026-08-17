# PCA R3 Dependency Graph

graph TD
  A[Requirement matrix and normative architecture] --> B[Invitation and enrollment lifecycle]
  A --> C[Protection capability state contract]
  A --> D[Identity and authority model]
  A --> E[Privacy, retention, export, recovery]
  B --> F[Backend persistence and HTTP transitions]
  C --> G[Android runtime and Parent Web display]
  D --> B
  D --> E
  B --> H[Device owner or provider authorization]
  C --> H
  E --> I[Independent security and red-team review]
  G --> J[Android build, unit, lint, artifact]
  G --> K[Physical device and instrumentation]
  H --> K
  B --> L[Backend unit, MySQL, mutation, security]
  A --> M[Terminology and localization audit]
  J --> N[R3 acceptance package]
  K --> N
  L --> N
  I --> N
  M --> N

The graph is a dependency map, not a completion declaration. A green source build does not satisfy a device, provider, owner-decision, database, security, or independent-review edge.
