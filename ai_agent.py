"""
ai_agent.py
-----------
Gemini-powered AI agent layer for PatentLens Studio.

Provides two core capabilities:
  1. generate_search_strategy()  — converts a raw product requirement into
     optimised Google Patents search queries + CPC classification codes.
  2. analyze_relevance()         — scores a scraped patent against the
     original requirement and returns a structured relevance assessment.

All LLM calls use Gemini structured-output (response_schema) so the SDK
parses the JSON directly into Pydantic models — no regex / manual parsing.

Environment:
  GEMINI_API_KEY  — your Google AI Studio key (loaded from .env)
"""

import logging
import os
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# ── Logging setup ────────────────────────────────────────────────────────────
logger = logging.getLogger("ai_agent")

# ── Load environment ─────────────────────────────────────────────────────────
load_dotenv()

# ── Gemini client initialisation ─────────────────────────────────────────────
try:
    from google import genai
    from google.genai import types

    _api_key = os.getenv("GEMINI_API_KEY")
    if not _api_key:
        raise EnvironmentError(
            "GEMINI_API_KEY is not set. "
            "Create a .env file in the project root with: GEMINI_API_KEY=<your-key>"
        )

    gemini_client = genai.Client(api_key=_api_key)
    GEMINI_MODEL = "gemini-3.5-flash"
    logger.info("[AI Agent] Gemini client initialised with model: %s", GEMINI_MODEL)

except ImportError as exc:
    raise ImportError(
        "google-genai package is not installed. "
        "Run: pip install google-genai"
    ) from exc


# ── Pydantic output schemas ───────────────────────────────────────────────────

class SearchStrategy(BaseModel):
    """Structured search plan produced by the LLM Planner."""
    keyword_queries: list[str] = Field(
        description=(
            "List of 2-4 highly targeted Google Patents search query strings "
            "using Boolean operators (AND / OR / NOT) and exact-phrase quotes. "
            "Prefer technical nomenclature over colloquial terms."
        )
    )
    suggested_cpc_codes: list[str] = Field(
        description=(
            "List of the most relevant CPC patent classification codes "
            "(e.g. B60R22/00, H04L67/12). Include 2-5 codes when applicable."
        )
    )
    search_rationale: str = Field(
        description=(
            "1-2 sentences explaining the chosen search strategy and why these "
            "queries and CPC codes best capture the inventive concept."
        )
    )


class RelevanceAssessment(BaseModel):
    """Per-patent relevance judgment produced by the LLM Auditor."""
    is_related: bool = Field(
        description=(
            "True if the patent discloses or meaningfully touches upon the "
            "core mechanism described in the product requirement, False otherwise."
        )
    )
    relevance_category: str = Field(
        description=(
            "Strictly categorize the patent's relevance into one of three values: "
            "'closely_relevant' (covers most/all of the core inventive concept), "
            "'mildly_relevant' (discloses some components or overlapping features), or "
            "'not_relevant' (unrelated, or has only generic keyword overlap)."
        )
    )
    confidence_score: float = Field(
        description=(
            "Relevance confidence from 0.0 (completely unrelated) to 1.0 "
            "(directly covers the claimed mechanism). Use 0.5 for ambiguous cases."
        )
    )
    reasoning: str = Field(
        description=(
            "One concise sentence explaining why this patent is classified under the "
            "chosen relevance category."
        )
    )
    overlap_reasons: str = Field(
        default="",
        description=(
            "A detailed explanation of WHAT specific technical features, mechanisms, or "
            "functionalities in this patent overlap with the user's invention. "
            "Mention specific shared subsystems, components, algorithms, or methods. "
            "E.g. 'Both inventions use piezoelectric pressure sensors embedded in seat "
            "belt retractors to measure occupant weight.' "
            "Leave empty only if there is zero technical overlap."
        )
    )
    difference_reasons: str = Field(
        default="",
        description=(
            "A detailed explanation of HOW the user's invention differs from this patent. "
            "Highlight what the user's invention does that this patent does NOT cover, "
            "including unique mechanisms, novel combinations, or different application domains. "
            "E.g. 'The user invention dynamically adjusts pre-tension force in real-time "
            "using a feedback loop, whereas this patent only performs static calibration.' "
            "Leave empty only if the patent fully covers the invention."
        )
    )


# ── Step 1: AI Keyword / Query Generator ─────────────────────────────────────

def generate_search_strategy(user_requirement: str) -> SearchStrategy:
    """
    Send the user's raw product requirement to Gemini and receive a structured
    search strategy (boolean queries + CPC codes).

    Args:
        user_requirement: Free-text description of the invention mechanism.

    Returns:
        SearchStrategy Pydantic model with queries, CPC codes, and rationale.

    Raises:
        ValueError: If the Gemini response cannot be parsed into the schema.
        RuntimeError: On any Gemini API or network failure.
    """
    prompt = (
        "You are an expert patent searcher and IP analyst. "
        "Analyse the following product requirement / invention description "
        "and produce a structured prior-art search strategy for Google Patents.\n\n"
        "Requirements:\n"
        "- Generate 2-4 diverse Boolean search queries using AND / OR / NOT operators.\n"
        "- Each query should target a different technical angle of the invention.\n"
        "- Include exact phrases in double quotes where precision is needed.\n"
        "- Suggest 2-5 relevant CPC classification codes.\n"
        "- Provide a brief rationale for the chosen strategy.\n\n"
        f"Product Requirement:\n{user_requirement}"
    )

    logger.info("[AI Agent] Generating search strategy for requirement (%d chars)...", len(user_requirement))

    try:
        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=SearchStrategy,
                temperature=0.15,
                max_output_tokens=2048,
            ),
        )

        result: SearchStrategy = response.parsed
        if result is None:
            # Fallback: attempt manual parse from text
            import json
            raw_text = response.text or ""
            logger.warning("[AI Agent] response.parsed was None, attempting manual JSON parse.")
            data = json.loads(raw_text)
            result = SearchStrategy(**data)

        logger.info(
            "[AI Agent] Strategy generated: %d queries, %d CPC codes.",
            len(result.keyword_queries),
            len(result.suggested_cpc_codes),
        )
        for i, q in enumerate(result.keyword_queries, 1):
            logger.info("  Query %d: %s", i, q)
        for code in result.suggested_cpc_codes:
            logger.info("  CPC: %s", code)

        return result

    except Exception as exc:
        logger.error("[AI Agent] generate_search_strategy FAILED: %s", exc, exc_info=True)
        raise RuntimeError(f"LLM Planner failed: {exc}") from exc


# ── Step 3: LLM Relevance Auditor ────────────────────────────────────────────

def analyze_relevance(
    user_requirement: str,
    patent_title: str,
    patent_abstract: str,
) -> RelevanceAssessment:
    """
    Ask Gemini to judge whether a scraped patent is relevant to the original
    product requirement.

    Args:
        user_requirement: The original free-text product description.
        patent_title:     Title of the scraped patent.
        patent_abstract:  Abstract text of the scraped patent.

    Returns:
        RelevanceAssessment with is_related, relevance_category, confidence_score, and reasoning.

    Raises:
        RuntimeError: On any Gemini API or network failure.
    """
    # Truncate abstract to avoid token overflow
    abstract_trimmed = patent_abstract[:3000] if len(patent_abstract) > 3000 else patent_abstract

    prompt = (
        "You are a patent examiner conducting a prior-art relevance review.\n\n"
        f"Product Mechanism Under Review:\n{user_requirement}\n\n"
        f"Candidate Patent:\n"
        f"Title: {patent_title}\n"
        f"Abstract: {abstract_trimmed}\n\n"
        "Task: Determine if this patent constitutes prior art for the described mechanism and classify its relevance.\n"
        "Relevance Category Definitions:\n"
        "- closely_relevant (Red status): The patent covers most or all of the core mechanical details/inventive concept.\n"
        "- mildly_relevant (Yellow status): The patent discloses some elements or subsystems of the mechanism, but not the specific combination.\n"
        "- not_relevant (Green status): The patent is unrelated or has only superficial/generic keyword overlaps.\n\n"
        "IMPORTANT — You MUST provide detailed analysis:\n"
        "1. overlap_reasons: Explain EXACTLY which specific technical features, components, algorithms, or methods "
        "in this patent overlap with the user's invention. Mention specific functionalities that are shared. "
        "Be precise (e.g. 'Both use capacitive soil moisture sensors connected via LoRa to a central hub').\n"
        "2. difference_reasons: Explain EXACTLY how the user's invention differs from this patent. "
        "What does the user's invention do that this patent does NOT? What novel mechanisms, combinations, "
        "or approaches does the user's invention have? (e.g. 'This patent lacks the machine learning-based "
        "predictive watering schedule that the user's invention implements').\n\n"
        "Be strict and professional. Place under closely_relevant or mildly_relevant only if there is a clear technical overlap."
    )

    logger.debug(
        "[AI Agent] Auditing patent: '%s...' (%d abstract chars)",
        patent_title[:60],
        len(abstract_trimmed),
    )

    try:
        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=RelevanceAssessment,
                temperature=0.1,
                max_output_tokens=512,
            ),
        )

        result: RelevanceAssessment = response.parsed
        if result is None:
            import json
            raw_text = response.text or ""
            logger.warning("[AI Agent] Relevance response.parsed was None, attempting manual parse.")
            data = json.loads(raw_text)
            result = RelevanceAssessment(**data)

        # Force normalization of category value
        cat = str(result.relevance_category).strip().lower()
        if "closely" in cat:
            result.relevance_category = "closely_relevant"
        elif "mildly" in cat:
            result.relevance_category = "mildly_relevant"
        else:
            result.relevance_category = "not_relevant"

        logger.debug(
            "[AI Agent] Audit result → related=%s, category=%s, score=%.2f | %s",
            result.is_related,
            result.relevance_category,
            result.confidence_score,
            result.reasoning,
        )
        return result

    except Exception as exc:
        logger.error(
            "[AI Agent] analyze_relevance FAILED for '%s': %s",
            patent_title[:60],
            exc,
            exc_info=True,
        )
        # Return a safe default — don't crash the whole pipeline for one patent
        return RelevanceAssessment(
            is_related=False,
            relevance_category="not_relevant",
            confidence_score=0.0,
            reasoning=f"Relevance check failed (error: {str(exc)[:100]})",
            overlap_reasons="",
            difference_reasons="",
        )
