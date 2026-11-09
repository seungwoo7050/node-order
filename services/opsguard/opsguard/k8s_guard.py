from __future__ import annotations

from typing import Any

import yaml

from opsguard.models import PolicyReport, Severity, Violation

SUPPORTED_WORKLOAD_KINDS: frozenset[str] = frozenset(
    {"Deployment", "StatefulSet", "Rollout"}
)


def _is_latest_or_untagged(image: str) -> bool:
    if not image:
        return True
    if "@" in image:
        return False
    last_slash = image.rfind("/")
    name_part = image[last_slash + 1 :] if last_slash != -1 else image
    if ":" not in name_part:
        return True
    tag = name_part.split(":", 1)[1]
    return tag.lower() == "latest"


def evaluate_k8s_manifests(yaml_content: str) -> PolicyReport:
    """Validate Kubernetes, Helm, and Argo Rollouts manifests for production invariants."""
    violations: list[Violation] = []

    try:
        documents = list(yaml.safe_load_all(yaml_content))
    except yaml.YAMLError as exc:
        violations.append(
            Violation(
                rule_id="K8S000",
                severity=Severity.ERROR,
                resource="manifest",
                message=f"YAML parsing error: {exc}",
                remediation="Ensure the manifest content is valid Kubernetes YAML.",
            )
        )
        return PolicyReport.create(target_type="k8s_manifest", violations=violations)

    for doc_idx, doc in enumerate(documents):
        if not isinstance(doc, dict):
            continue

        kind = str(doc.get("kind", ""))
        metadata = doc.get("metadata") or {}
        name = str(metadata.get("name", f"unnamed-doc-{doc_idx}"))
        res_id = f"{kind}/{name}"

        # Workload checks: Deployment, StatefulSet, Rollout
        if kind in SUPPORTED_WORKLOAD_KINDS:
            spec = doc.get("spec") or {}
            template = spec.get("template") or {}
            pod_spec = template.get("spec") or {}
            containers: list[dict[str, Any]] = pod_spec.get("containers") or []

            for container in containers:
                c_name = container.get("name", "unknown")
                c_res = f"{res_id}/{c_name}"
                image = str(container.get("image", ""))

                # K8S001: Image tag latest or missing
                if _is_latest_or_untagged(image):
                    violations.append(
                        Violation(
                            rule_id="K8S001",
                            severity=Severity.ERROR,
                            resource=c_res,
                            message=f"Container '{c_name}' uses prohibited image tag '{image}' (tag missing or :latest)",
                            remediation="Pin explicit immutable tag or sha256 digest instead of :latest or untagged images.",
                        )
                    )

                # K8S002: Memory request and limit enforcement
                resources = container.get("resources") or {}
                limits = resources.get("limits") or {}
                requests = resources.get("requests") or {}
                if not limits.get("memory") or not requests.get("memory"):
                    violations.append(
                        Violation(
                            rule_id="K8S002",
                            severity=Severity.ERROR,
                            resource=c_res,
                            message=f"Container '{c_name}' is missing resources.limits.memory or resources.requests.memory",
                            remediation="Specify both resources.requests.memory and resources.limits.memory to prevent OOM cascade.",
                        )
                    )

                # K8S003: Probes enforcement
                readiness = container.get("readinessProbe")
                liveness = container.get("livenessProbe")
                if not readiness or not liveness:
                    violations.append(
                        Violation(
                            rule_id="K8S003",
                            severity=Severity.ERROR,
                            resource=c_res,
                            message=f"Container '{c_name}' is missing livenessProbe or readinessProbe",
                            remediation="Configure both livenessProbe and readinessProbe to allow graceful pod scheduling and restart.",
                        )
                    )

        # Argo Rollouts specific validation
        if kind == "Rollout":
            spec = doc.get("spec") or {}
            strategy = spec.get("strategy") or {}
            canary = strategy.get("canary") or {}
            steps: list[dict[str, Any]] = canary.get("steps") or []

            has_analysis = False
            weights: list[int] = []

            for step in steps:
                if "analysis" in step:
                    has_analysis = True
                if "setWeight" in step:
                    try:
                        weights.append(int(step["setWeight"]))
                    except (ValueError, TypeError):
                        pass

            # ARGO001: setWeight monotonic increase & analysis step requirement
            is_monotonic = len(weights) > 0 and all(
                weights[i] < weights[i + 1] for i in range(len(weights) - 1)
            )

            if not steps or not is_monotonic or not has_analysis:
                reasons: list[str] = []
                if not steps:
                    reasons.append("canary steps are empty")
                if not is_monotonic:
                    reasons.append(
                        f"setWeight sequence {weights} is not strictly monotonically increasing"
                    )
                if not has_analysis:
                    reasons.append("missing automated analysis step")

                violations.append(
                    Violation(
                        rule_id="ARGO001",
                        severity=Severity.ERROR,
                        resource=res_id,
                        message=f"Rollout '{name}' canary strategy invalid: {', '.join(reasons)}",
                        remediation="Configure spec.strategy.canary.steps with monotonically increasing setWeight values and at least one analysis step.",
                    )
                )

    return PolicyReport.create(target_type="k8s_manifest", violations=violations)
