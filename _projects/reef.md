---
layout: page
title: Reef
role: Contributor
description: Reef is open-source infrastructure for continually self-improving agents, connecting inference, feedback, learning, and versioned delivery.
contribution: I integrated Semantic Router for scenario-aware model routing and implemented router lifecycle management and policy updates.
icon: assets/img/reef-icon.svg
importance: 1
category: open source
github: https://github.com/Human-Agent-Society/reef
github_stars_count: "7,786"
github_stars_checked: "Nov 8, 2026"
pull_request: https://github.com/Human-Agent-Society/reef/pull/859
pull_request_label: "Merged PR #859"
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

### Semantic Router integration

I integrated Semantic Router into Reef to select models within each scenario's allowed targets. The integration supports default and keyword-based policies, as well as explicit target selection.

I also implemented managed router lifecycle and policy updates with request draining and rollback, while preserving inference records and their feedback linkage.

[View merged PR #859: integrate Semantic Router]({{ page.pull_request }}).
