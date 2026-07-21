import Foundation

/// Генерирует WAV-данные тишины. Проигрываются в цикле во время пауз, чтобы iOS
/// не считал аудио остановленным и не убивал фоновую сессию (спека §8).
enum SilenceAudio {
    /// ~0.5 c тишины, PCM 16-bit mono @ 8 кГц — достаточно для зацикливания.
    static let wavData: Data = makeWAV(seconds: 0.5, sampleRate: 8000)

    private static func makeWAV(seconds: Double, sampleRate: Int) -> Data {
        let channels = 1
        let bitsPerSample = 16
        let frameCount = Int(Double(sampleRate) * seconds)
        let dataSize = frameCount * channels * (bitsPerSample / 8)
        let byteRate = sampleRate * channels * (bitsPerSample / 8)
        let blockAlign = channels * (bitsPerSample / 8)

        var data = Data()
        func appendString(_ s: String) { data.append(contentsOf: Array(s.utf8)) }
        func appendUInt32LE(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        func appendUInt16LE(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }

        appendString("RIFF")
        appendUInt32LE(UInt32(36 + dataSize))
        appendString("WAVE")
        appendString("fmt ")
        appendUInt32LE(16)                       // размер fmt-чанка
        appendUInt16LE(1)                        // PCM
        appendUInt16LE(UInt16(channels))
        appendUInt32LE(UInt32(sampleRate))
        appendUInt32LE(UInt32(byteRate))
        appendUInt16LE(UInt16(blockAlign))
        appendUInt16LE(UInt16(bitsPerSample))
        appendString("data")
        appendUInt32LE(UInt32(dataSize))
        data.append(Data(count: dataSize))       // нули = тишина
        return data
    }
}
