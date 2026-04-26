import Foundation
import AppKit
import PDFKit
import Vision

struct PageRecord: Encodable {
    let page_number: Int
    let text: String
    let extraction_method: String
    let quality: String
    let warnings: [String]
}

struct OutputRecord: Encodable {
    let doc_id: String
    let source_file: String
    let language: String
    let page_count: Int
    let title: String?
    let pages: [PageRecord]
}

struct TextAssessment {
    let quality: String
    let warnings: [String]
    let score: Int
}

func renderPageImage(_ page: PDFPage, scale: CGFloat = 2.0) -> CGImage? {
    let pageRect = page.bounds(for: .mediaBox)
    guard pageRect.width > 0, pageRect.height > 0 else { return nil }

    let width = Int(pageRect.width * scale)
    let height = Int(pageRect.height * scale)

    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width,
        pixelsHigh: height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        return nil
    }

    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }

    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }
    NSGraphicsContext.current = context

    NSColor.white.set()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()

    let cgContext = context.cgContext
    cgContext.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: cgContext)

    return bitmap.cgImage
}

func qualityRank(_ quality: String) -> Int {
    switch quality {
    case "high":
        return 3
    case "medium":
        return 2
    default:
        return 1
    }
}

func assessText(_ text: String) -> TextAssessment {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        return TextAssessment(
            quality: "low",
            warnings: ["empty_text", "possible_scan_or_image_only"],
            score: 0
        )
    }

    let tokens = trimmed.split { $0.isWhitespace || $0.isNewline }
    let singleCharacterTokens = tokens.filter { $0.count == 1 }.count

    var letters = 0
    var digits = 0
    var punctuation = 0
    var visible = 0

    for scalar in trimmed.unicodeScalars {
        if CharacterSet.whitespacesAndNewlines.contains(scalar) {
            continue
        }
        visible += 1
        if CharacterSet.decimalDigits.contains(scalar) {
            digits += 1
            continue
        }
        if CharacterSet.letters.contains(scalar) {
            letters += 1
            continue
        }
        punctuation += 1
    }

    let lines = max(trimmed.split(whereSeparator: \.isNewline).count, 1)
    let visibleCount = max(visible, 1)
    let letterRatio = Double(letters) / Double(visibleCount)
    let digitRatio = Double(digits) / Double(visibleCount)
    let singleTokenRatio = tokens.isEmpty ? 0.0 : Double(singleCharacterTokens) / Double(tokens.count)

    var warnings: [String] = []
    if trimmed.count < 120 || letters < 50 {
        warnings.append("very_short_page_text")
    } else if trimmed.count < 500 || letters < 220 || lines < 6 {
        warnings.append("limited_page_text")
    }

    if letterRatio < 0.45 || digitRatio > 0.18 || singleTokenRatio > 0.35 {
        warnings.append("garbled_text_candidate")
    }

    let quality: String
    if warnings.contains("very_short_page_text") || warnings.contains("garbled_text_candidate") {
        quality = "low"
    } else if warnings.contains("limited_page_text") {
        quality = "medium"
    } else {
        quality = "high"
    }

    let score = max(0, letters * 2 + lines * 8 - digits * 3 - singleCharacterTokens * 4 - punctuation)
    return TextAssessment(quality: quality, warnings: Array(Set(warnings)).sorted(), score: score)
}

func shouldReplaceText(current: String, currentAssessment: TextAssessment, candidate: String, candidateAssessment: TextAssessment) -> Bool {
    let currentTrimmed = current.trimmingCharacters(in: .whitespacesAndNewlines)
    let candidateTrimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)

    if currentTrimmed.isEmpty && !candidateTrimmed.isEmpty {
        return true
    }
    if qualityRank(candidateAssessment.quality) > qualityRank(currentAssessment.quality) {
        return true
    }
    return candidateAssessment.score > currentAssessment.score + 25
}

func performOCR(
    on page: PDFPage,
    scale: CGFloat,
    recognitionLanguages: [String],
    usesLanguageCorrection: Bool
) -> String? {
    guard let image = renderPageImage(page, scale: scale) else { return nil }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = usesLanguageCorrection
    request.recognitionLanguages = recognitionLanguages

    let handler = VNImageRequestHandler(cgImage: image, options: [:])

    do {
        try handler.perform([request])
    } catch {
        return nil
    }

    guard let observations = request.results else { return nil }
    let lines = observations.compactMap { $0.topCandidates(1).first?.string }
    let text = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
}

func bestOCRCandidate(for page: PDFPage) -> (String, TextAssessment)? {
    let attempts: [(CGFloat, [String], Bool)] = [
        (3.0, ["fr-FR", "en-US"], true),
        (3.0, ["ar"], false),
        (2.5, ["ar", "fr-FR", "en-US"], false),
    ]

    var best: (String, TextAssessment)?
    for (scale, languages, correction) in attempts {
        guard let text = performOCR(on: page, scale: scale, recognitionLanguages: languages, usesLanguageCorrection: correction) else {
            continue
        }
        let assessment = assessText(text)
        if let existing = best {
            if qualityRank(assessment.quality) > qualityRank(existing.1.quality) || assessment.score > existing.1.score + 10 {
                best = (text, assessment)
            }
        } else {
            best = (text, assessment)
        }
    }
    return best
}

func detectLanguage(_ text: String, fallbackName: String) -> String {
    let arabicRange = text.unicodeScalars.filter { $0.value >= 0x0600 && $0.value <= 0x06FF }.count
    let latinRange = text.unicodeScalars.filter { CharacterSet.letters.contains($0) && $0.value < 0x0600 }.count
    if arabicRange > 20 && latinRange > 20 { return "mixed" }
    if arabicRange > 20 { return "ar" }
    let lowerName = fallbackName.lowercased()
    if lowerName.contains("_ar") || lowerName.contains(" ar") || lowerName.contains("arab") {
        return "ar"
    }
    if latinRange > 20 { return "fr" }
    if lowerName.contains("_fr") || lowerName.contains("(fr") || lowerName.contains(" fr") {
        return "fr"
    }
    return "unknown"
}

guard CommandLine.arguments.count >= 3 else {
    fputs("Usage: extract_pdf_pages.swift <doc_id> <pdf_path>\n", stderr)
    exit(1)
}

let docID = CommandLine.arguments[1]
let pdfPath = CommandLine.arguments[2]
let pdfURL = URL(fileURLWithPath: pdfPath)

guard let document = PDFDocument(url: pdfURL) else {
    fputs("Cannot open PDF at \(pdfPath)\n", stderr)
    exit(2)
}

var pages: [PageRecord] = []
var aggregateText = ""

for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { continue }
    let nativeText = (page.string ?? "").replacingOccurrences(of: "\u{0}", with: "")
    let nativeAssessment = assessText(nativeText)

    var finalText = nativeText
    var extractionMethod = "native_text"
    var finalAssessment = nativeAssessment
    var warnings = nativeAssessment.warnings

    let needsOCRAttempt = nativeAssessment.quality != "high" || nativeAssessment.warnings.contains("garbled_text_candidate")
    if needsOCRAttempt {
        if let (ocrText, ocrAssessment) = bestOCRCandidate(for: page) {
            let normalizedOCR = ocrText.replacingOccurrences(of: "\u{0}", with: "")
            if shouldReplaceText(current: finalText, currentAssessment: finalAssessment, candidate: normalizedOCR, candidateAssessment: ocrAssessment) {
                finalText = normalizedOCR
                extractionMethod = nativeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "ocr" : "mixed"
                finalAssessment = ocrAssessment
                warnings = Array(Set(ocrAssessment.warnings + ["ocr_used"])).sorted()
            } else {
                warnings = Array(Set(warnings + ["ocr_attempt_not_selected"])).sorted()
            }
        } else {
            warnings = Array(Set(warnings + ["ocr_attempt_failed"])).sorted()
        }
    }

    aggregateText += "\n" + finalText
    let finalComputedAssessment = assessText(finalText)
    let mergedWarnings = Array(Set(warnings + finalComputedAssessment.warnings)).sorted()
    pages.append(PageRecord(
        page_number: index + 1,
        text: finalText,
        extraction_method: extractionMethod,
        quality: finalComputedAssessment.quality,
        warnings: mergedWarnings
    ))
}

let title = document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String
let language = detectLanguage(aggregateText, fallbackName: pdfURL.lastPathComponent)

let output = OutputRecord(
    doc_id: docID,
    source_file: pdfPath,
    language: language,
    page_count: document.pageCount,
    title: title,
    pages: pages
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
let data = try encoder.encode(output)
FileHandle.standardOutput.write(data)
