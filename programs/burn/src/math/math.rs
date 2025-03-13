pub fn ceil_div(a: u128, b: u128) -> u128 {
    let r = a / b;
    if r * b == a {
        r
    } else {
        r + 1
    }
}

#[cfg(test)]
mod tests {
    #[test]
    pub fn test_ceil_div() {
        assert_eq!(super::ceil_div(10, 3), 4);
        assert_eq!(super::ceil_div(10, 5), 2);
        assert_eq!(super::ceil_div(10, 10), 1);
    }
}
