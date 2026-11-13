---
layout: page
title: Reef
role: Contributor
description: Reef is open-source infrastructure for continually self-improving agents, connecting inference, feedback, learning, and versioned delivery.
icon: assets/img/reef-icon.svg
importance: 1
category: open source
github: https://github.com/Human-Agent-Society/reef
github_stars_count: "7,806"
github_stars_checked: "Nov 12, 2026"
merged_pull_requests:
  - number: 1373
    url: https://github.com/Human-Agent-Society/reef/pull/1373
    title: Automatic Semantic Router image builds
    summary: I removed the Semantic Router submodule and added automatic builds from pinned upstream source, with validated local image reuse. Managed deployments can now prepare the router image without a manual build step, while retaining support for explicit image overrides.
  - number: 859
    url: https://github.com/Human-Agent-Society/reef/pull/859
    title: Semantic Router integration
    summary: I integrated Semantic Router for scenario-aware model selection, supporting default and keyword-based policies and explicit targets. I also implemented router lifecycle management and policy updates with request draining and rollback, preserving inference records and feedback linkage.
  - number: 991
    url: https://github.com/Human-Agent-Society/reef/pull/991
    title: Concurrent artifact initialization and event test fixes
    summary: I fixed a race in concurrent Git LFS artifact repository initialization and corrected experiment event assertions to avoid depending on the timing of in-memory state updates.
---

<p class="d-flex align-items-center">
  <img src="{{ page.icon | relative_url }}" alt="Reef logo" class="mr-3" style="width: 3rem; height: 3rem; object-fit: contain; background: #fff; border-radius: 0.35rem; padding: 0.25rem;">
  <strong>Contributor to Reef</strong>
</p>

Reef is open-source infrastructure for continually self-improving agents. It connects inference, feedback, learning, and versioned delivery so agents can improve their model weights or their prompts, rules, and skills.

<p>
  <a href="{{ page.github }}"><i class="fa-brands fa-github" aria-hidden="true"></i> Human-Agent-Society/reef</a>
  &nbsp;·&nbsp;
  <a href="{{ page.github }}/stargazers"><i class="fa-solid fa-star" aria-hidden="true"></i> {{ page.github_stars_count }} stars</a>
  <span class="text-muted">(as of {{ page.github_stars_checked }})</span>
</p>

## Merged contributions

{% for pr in page.merged_pull_requests %}

### {{ pr.title }}

{{ pr.summary }}

[View merged PR #{{ pr.number }}]({{ pr.url }})

{% endfor %}
