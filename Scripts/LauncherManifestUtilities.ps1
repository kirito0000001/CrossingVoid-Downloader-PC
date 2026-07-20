function Convert-ToRfc3339Timestamp {
    param([AllowNull()][object]$Value)

    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    $utc = if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        [DateTimeOffset]::UtcNow
    } elseif ($Value -is [DateTimeOffset]) {
        ([DateTimeOffset]$Value).ToUniversalTime()
    } elseif ($Value -is [DateTime]) {
        $dateTime = [DateTime]$Value
        if ($dateTime.Kind -eq [DateTimeKind]::Unspecified) {
            $dateTime = [DateTime]::SpecifyKind($dateTime, [DateTimeKind]::Utc)
        }
        [DateTimeOffset]::new($dateTime.ToUniversalTime())
    } else {
        $parsed = [DateTimeOffset]::MinValue
        $styles = [System.Globalization.DateTimeStyles]::AllowWhiteSpaces -bor [System.Globalization.DateTimeStyles]::AssumeUniversal
        if (![DateTimeOffset]::TryParse([string]$Value, $culture, $styles, [ref]$parsed)) {
            throw "无法将发布时间转换为 RFC 3339：$Value"
        }
        $parsed.ToUniversalTime()
    }

    return $utc.ToString("yyyy-MM-ddTHH:mm:ss.fffffff'Z'", $culture)
}
